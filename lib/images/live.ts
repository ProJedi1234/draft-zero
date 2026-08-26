// lib/images/live.ts — The process-global registry of live IMAGE runs.
//
// The picture-shaped twin of lib/generation/live.ts, and server-owned for the
// same reason: the request that starts a draw is the first thing that can die,
// and before this module existed it took the draw with it — closing the tab
// aborted the upstream request, so a 30-second render did not survive a phone
// going to sleep. Now the route launches a detached loop and returns; clients
// are pure subscribers, and only stopImageRun aborts the provider.
//
// Deliberately its OWN registry rather than a kind on the text one: a story is
// allowed to stream prose and draw a picture at the same time, and folding the
// two into one one-run-per-story map would make each block the other. What is
// shared is the architecture — snapshot + incrementals + terminal frame, the
// same bus, the same subscribe shape — so a reader of either module can read
// the other.
//
// No reservation apparatus, on purpose. The text side reserves because its
// start persists a turn row across several awaits before launching; an image
// start persists nothing before the launch, so two racing starts cost nothing —
// the second simply loses the synchronous Map check and answers busy.
import "server-only"

import { recordCallStarted, settleCall } from "@/lib/generation/calls"
import { resolveOpenRouterKey } from "@/lib/generation/key"
import { MockImageProvider } from "@/lib/images/mock-provider"
import { OpenRouterImageProvider } from "@/lib/images/openrouter"
import { persistIllustration } from "@/lib/images/persist"
import type {
  ImageGenerationProvider,
  ImageUsage,
} from "@/lib/images/types"
import { publishBus, touchStory } from "@/lib/sync/bus"
import type { ImageRunEndFrame, ImageRunFrame, ImageRunWireEvent } from "@/lib/sync/types"
import type { ImageAspectRatio, SettledCallStatus } from "@/lib/types"

/** Same linger as the text side: a subscriber racing the finish still gets snapshot + end. */
const LINGER_MS = 60_000

type ImageRunListener = (event: ImageRunWireEvent) => void

export interface LiveImageRun {
  readonly runId: string
  readonly storyId: string
  readonly prompt: string
  readonly aspectRatio: ImageAspectRatio
  /** The slot a retry redraws, or null for a new beat. */
  readonly imageGroupId: string | null
  readonly modelId: string
  readonly zdr: boolean
  readonly seed: number
  readonly storyTitle: string | null
  /** The ledger row, once one is opened. Stays null on the offline mock. */
  callId: string | null
  /** The snapshot: the sharpest partial so far. */
  previewB64: string | null
  previewMediaType: string | null
  /** Set exactly once, after the persist committed — a finished run IS its end frame. */
  end: ImageRunEndFrame | null
  /** True when the story is being deleted out from under the draw. */
  discarded: boolean
  readonly upstream: AbortController
  readonly listeners: Set<ImageRunListener>
}

// On globalThis for the same reason the text registry is: dev HMR re-evaluates
// this module while detached loops and open subscribe routes keep executing
// against the old copy, and two registries means a draw nobody can find or stop.
const globalForLive = globalThis as unknown as {
  __draftZeroImageLive?: {
    /** Keyed by storyId — one draw per story at a time. */
    active: Map<string, LiveImageRun>
    /** Finished runs by runId, kept for LINGER_MS then GC'd. */
    lingering: Map<string, LiveImageRun>
  }
}

const live = (globalForLive.__draftZeroImageLive ??= {
  active: new Map(),
  lingering: new Map(),
})

/** Same contract as the text side's findRun — see the comment there. */
export function findImageRun(
  storyId: string,
  runId?: string | null
): LiveImageRun | null {
  const active = live.active.get(storyId)
  if (active && (!runId || active.runId === runId)) return active
  if (runId) {
    const lingered = live.lingering.get(runId)
    if (lingered && lingered.storyId === storyId) return lingered
  }
  return null
}

export interface ImageRunAttachment {
  frame: ImageRunFrame
  end: ImageRunEndFrame | null
  detach: () => void
}

/**
 * Snapshot and listener in one synchronous pass, so no partial can fall in the
 * gap between "state so far" and "events from now on".
 */
export function attachImageRun(
  run: LiveImageRun,
  listener: ImageRunListener
): ImageRunAttachment {
  const frame: ImageRunFrame = {
    type: "image-run",
    runId: run.runId,
    storyId: run.storyId,
    prompt: run.prompt,
    aspectRatio: run.aspectRatio,
    imageGroupId: run.imageGroupId,
    previewB64: run.previewB64,
    previewMediaType: run.previewMediaType,
  }
  run.listeners.add(listener)
  return {
    frame,
    end: run.end,
    detach: () => run.listeners.delete(listener),
  }
}

export interface LaunchImageOpts {
  storyId: string
  storyTitle: string | null
  prompt: string
  aspectRatio: ImageAspectRatio
  imageGroupId?: string
  /** Concrete, already resolved — the run records what actually draws. */
  modelId: string
  zdr: boolean
  seed: number
}

/**
 * Registers the run and launches its loop as a detached task. Null when the
 * story is already drawing — the check and the claim are one synchronous Map
 * operation, so two racing sends cannot both win.
 */
export function launchImageRun(
  opts: LaunchImageOpts
): { runId: string } | null {
  if (live.active.has(opts.storyId)) return null

  const run: LiveImageRun = {
    runId: crypto.randomUUID(),
    storyId: opts.storyId,
    storyTitle: opts.storyTitle,
    prompt: opts.prompt,
    aspectRatio: opts.aspectRatio,
    imageGroupId: opts.imageGroupId ?? null,
    modelId: opts.modelId,
    zdr: opts.zdr,
    seed: opts.seed,
    callId: null,
    previewB64: null,
    previewMediaType: null,
    end: null,
    discarded: false,
    upstream: new AbortController(),
    listeners: new Set(),
  }
  live.active.set(run.storyId, run)
  // Before the first byte on purpose: devices on this story attach on this
  // event and watch the whole draw instead of arriving at the last partial.
  publishBus({
    kind: "image-run-started",
    storyId: run.storyId,
    runId: run.runId,
  })

  void imageRunLoop(run).catch((err) => {
    console.error("[image-live] run loop escaped its finally", err)
  })

  return { runId: run.runId }
}

/**
 * The only way a draw is ever aborted. Any device may call it. `runId` names
 * the run the caller was watching, so a stale device's Stop cannot kill a
 * later run under the same story; null aborts whatever is active, which is
 * safe here because — unlike text — nothing else can have started one in the
 * caller's blind spot without the composer showing it.
 */
export function stopImageRun(storyId: string, runId?: string | null): void {
  const active = live.active.get(storyId)
  if (active && (!runId || active.runId === runId)) {
    active.upstream.abort()
  }
}

/** Deleting a story takes its draw with it — abort, and persist nothing. */
export function discardStoryImageRun(storyId: string): void {
  const active = live.active.get(storyId)
  if (active) {
    active.discarded = true
    active.upstream.abort()
  }
}

async function imageRunLoop(run: LiveImageRun): Promise<void> {
  const key = resolveOpenRouterKey()
  const provider: ImageGenerationProvider = key
    ? new OpenRouterImageProvider(key)
    : new MockImageProvider()

  // Aborted is the default, exactly as in the text loop: both providers return
  // the moment their signal trips, so only the signal tells a Stop from a
  // finish, and every path that does not prove otherwise was cut short.
  let status: SettledCallStatus = "aborted"
  let errorMessage: string | null = null
  let final: { b64: string; mediaType: string; usage: ImageUsage } | null = null

  const fanOut = (event: ImageRunWireEvent) => {
    for (const listener of run.listeners) {
      try {
        listener(event)
      } catch {
        // A throwing subscriber is a broken socket, not a broken run.
      }
    }
  }

  try {
    // The offline mock bills nothing, so it opens no ledger row — a row with a
    // null cost would be indistinguishable from a call OpenRouter declined to
    // price. Opened BEFORE the provider call so a stopped or failed draw still
    // leaves its trace, same rule as the text side.
    if (key) {
      run.callId = crypto.randomUUID()
      await recordCallStarted({
        id: run.callId,
        storyId: run.storyId,
        origStoryId: run.storyId,
        storyTitle: run.storyTitle,
        requestKind: "illustrate",
        modelId: run.modelId,
        // Images do not think. Null rather than "off", which would claim a
        // reasoning setting was consulted and declined.
        thinking: null,
        providerName: null,
      })
    }

    try {
      for await (const event of provider.generate({
        prompt: run.prompt,
        modelId: run.modelId,
        zdr: run.zdr,
        aspectRatio: run.aspectRatio,
        seed: run.seed,
        signal: run.upstream.signal,
      })) {
        if (event.type === "partial") {
          // Folded into the snapshot BEFORE the fan-out, so an attacher sees
          // every preview exactly once — in its frame or live, never neither.
          run.previewB64 = event.b64
          run.previewMediaType = event.mediaType
          fanOut({
            type: "partial",
            b64: event.b64,
            mediaType: event.mediaType,
          })
        } else if (event.type === "completed") {
          final = {
            b64: event.b64,
            mediaType: event.mediaType,
            usage: event.usage,
          }
        }
      }
      status = run.upstream.signal.aborted
        ? "aborted"
        : final
          ? "ok"
          : "error"
      if (status === "error") {
        errorMessage = "The image provider returned no image."
      }
    } catch (err) {
      if (run.upstream.signal.aborted) {
        // Stop mid-flight. Under all-or-nothing image billing nothing was
        // charged — which is what the Stop tooltip promises.
        status = "aborted"
      } else {
        status = "error"
        errorMessage =
          err instanceof Error ? err.message : "The image request failed."
      }
    }
  } finally {
    await finishImageRun(run, status, errorMessage, final)
  }
}

/**
 * The single settle path: persist, settle the ledger, announce, end, linger —
 * the same order as the text side's finishRun, for the same reasons. The end
 * frame goes out only after the row committed, and touchStory rides between
 * the two so passive devices refetch a tree the picture is already in.
 */
async function finishImageRun(
  run: LiveImageRun,
  status: SettledCallStatus,
  errorMessage: string | null,
  final: { b64: string; mediaType: string; usage: ImageUsage } | null
): Promise<void> {
  let imageId: string | null = null
  let persistFailed = false

  // Only a completed draw persists: an aborted image has no partial worth
  // keeping (billing is all-or-nothing, and a blurry preview is not a picture),
  // and a discarded run's manuscript is being deleted.
  if (final !== null && status === "ok" && !run.discarded) {
    try {
      const persisted = await persistIllustration({
        storyId: run.storyId,
        imageGroupId: run.imageGroupId ?? undefined,
        prompt: run.prompt,
        derivedPrompt: null,
        modelId: run.modelId,
        aspectRatio: run.aspectRatio,
        seed: run.seed,
        mediaType: final.mediaType,
        b64: final.b64,
        callId: run.callId,
      })
      if (persisted.ok) {
        imageId = persisted.data.id
      } else {
        console.error("[image-live] persist refused:", persisted.error)
        persistFailed = true
      }
    } catch (err) {
      console.error("[image-live] persist failed", err)
      persistFailed = true
    }
  }

  if (run.callId) {
    await settleCall(run.callId, {
      status: persistFailed ? "error" : status,
      generationId: null,
      usage:
        final !== null
          ? {
              promptTokens: final.usage.promptTokens ?? 0,
              completionTokens: final.usage.completionTokens ?? 0,
              reasoningTokens: 0,
              costUsd: final.usage.costUsd,
              cachedPromptTokens: null,
              upstreamPromptCostUsd: null,
              upstreamCompletionCostUsd: null,
              isByok: null,
            }
          : null,
    })
  }

  // A drawn picture that could not be saved must not end "ok" — the account
  // was billed and the pixels are gone, and that is an error with a toast.
  const end: ImageRunEndFrame = {
    type: "end",
    status: persistFailed ? "error" : status,
    imageId,
    error: persistFailed
      ? "The picture was drawn but couldn't be saved."
      : status === "error"
        ? errorMessage
        : null,
  }

  // One synchronous block from here to the fan-out — an attacher lands before
  // or after, never between.
  run.end = end
  live.active.delete(run.storyId)
  live.lingering.set(run.runId, run)
  // Before the end frame on purpose: by the time the origin device settles,
  // every passive device has been told the tree moved.
  if (imageId !== null) touchStory(run.storyId)
  for (const listener of run.listeners) {
    try {
      listener(end)
    } catch {
      // Same bargain as fanOut: a dead socket must not mute the rest.
    }
  }
  run.listeners.clear()

  const timer = setTimeout(() => live.lingering.delete(run.runId), LINGER_MS)
  timer.unref?.()
}
