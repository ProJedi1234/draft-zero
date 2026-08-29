// lib/images/derive-run.ts — The process-global registry of live DERIVATION
// runs: the develop call that turns a writer's brief into an image prompt.
//
// The third registry, after prose (lib/generation/live.ts) and pictures
// (lib/images/live.ts), and server-owned for the reason the other two are: the
// request that starts a develop is the first thing that can die. It used to own
// the whole call — the composer read the stream off its own POST body — which
// made the derivation the one paid call in the app that a closed tab threw
// away, and the one thing the writer's second device could not see happening.
// Now the route launches a detached loop and returns a runId; every device on
// the story watches, and the settled prompt lands in the draft row whether or
// not anybody was still looking.
//
// Its OWN registry rather than a kind on the image one, even though both live
// in lib/images: a story is allowed to develop a brief while it draws, and one
// map keyed by story would make each block the other. They are different run
// SHAPES too — this one accumulates text and ends by writing a draft row, that
// one accumulates pixels and ends by writing an illustration. What is shared is
// the architecture, so a reader of either can read the other.
//
// No stop path, on purpose. A develop is seconds long, so a Stop control would
// be a button nobody could hit in time; the only abort is the story being
// deleted out from under it.
import "server-only"

import { getDb } from "@/lib/db/client"
import { composerDrafts } from "@/lib/db/schema"
import { recordCallStarted, settleCall } from "@/lib/generation/calls"
import { chunkText } from "@/lib/generation/fixtures"
import { resolveOpenRouterKey } from "@/lib/generation/key"
import { mapOpenRouterError } from "@/lib/generation/openrouter"
import { streamDerivation } from "@/lib/images/derive-live"
import { publishBus } from "@/lib/sync/bus"
import { SERVER_DRAFT_ORIGIN } from "@/lib/sync/draft"
import type {
  DeriveRunEndFrame,
  DeriveRunFrame,
  DeriveRunWireEvent,
} from "@/lib/sync/types"
import type { GenerationSettings, SettledCallStatus } from "@/lib/types"

/** Same linger as the other two registries: a subscriber racing the finish still gets frame + end. */
const LINGER_MS = 60_000

/** How the offline stand-in paces itself, so the mock reads as a stream. */
const OFFLINE_CHUNK_DELAY_MS = 40

type DeriveRunListener = (event: DeriveRunWireEvent) => void

export interface LiveDeriveRun {
  readonly runId: string
  readonly storyId: string
  readonly storyTitle: string | null
  /** Server wall-clock, so every device dates the run the same way. */
  readonly startedAt: string
  /**
   * The question this run is answering — the writer's brief, or "" for the
   * older gesture (describe where the story is now). Carried through to the
   * frame because the composer's staleness mark is a comparison against it,
   * and a device that attached mid-run has no other way to know it.
   */
  readonly brief: string
  /** The rendered turn. Composed by the launcher; this module only carries it. */
  readonly system: string
  readonly user: string
  /** What the offline stand-in streams when there is no key. */
  readonly offlineText: string
  readonly settings: GenerationSettings
  /** The ledger row, once one is opened. Stays null offline. */
  callId: string | null
  /** The snapshot: everything the model has written so far. */
  textSoFar: string
  /** Set exactly once, after the draft row committed — a finished run IS its end frame. */
  end: DeriveRunEndFrame | null
  /** True when the story is being deleted out from under the develop. */
  discarded: boolean
  readonly upstream: AbortController
  readonly listeners: Set<DeriveRunListener>
}

// On globalThis for the same reason the other two registries are: dev HMR
// re-evaluates this module while detached loops and open subscribe routes keep
// executing against the old copy, and two registries means a develop nobody
// can find.
const globalForDerive = globalThis as unknown as {
  __draftZeroDeriveLive?: {
    /** Keyed by storyId — one develop per story at a time. */
    active: Map<string, LiveDeriveRun>
    /** Finished runs by runId, kept for LINGER_MS then GC'd. */
    lingering: Map<string, LiveDeriveRun>
  }
}

const live = (globalForDerive.__draftZeroDeriveLive ??= {
  active: new Map(),
  lingering: new Map(),
})

/** Same contract as findImageRun — see the comment there. */
export function findDeriveRun(
  storyId: string,
  runId?: string | null
): LiveDeriveRun | null {
  const active = live.active.get(storyId)
  if (active && (!runId || active.runId === runId)) return active
  if (runId) {
    const lingered = live.lingering.get(runId)
    if (lingered && lingered.storyId === storyId) return lingered
  }
  return null
}

export interface DeriveRunAttachment {
  frame: DeriveRunFrame
  end: DeriveRunEndFrame | null
  detach: () => void
}

/**
 * Snapshot and listener in one synchronous pass, so no increment can fall in
 * the gap between "text so far" and "text from now on".
 */
export function attachDeriveRun(
  run: LiveDeriveRun,
  listener: DeriveRunListener
): DeriveRunAttachment {
  const frame: DeriveRunFrame = {
    type: "derive-run",
    runId: run.runId,
    storyId: run.storyId,
    brief: run.brief,
    text: run.textSoFar,
  }
  run.listeners.add(listener)
  return {
    frame,
    end: run.end,
    detach: () => run.listeners.delete(listener),
  }
}

export interface LaunchDeriveOpts {
  storyId: string
  storyTitle: string | null
  brief: string
  system: string
  user: string
  offlineText: string
  settings: GenerationSettings
}

/**
 * Registers the run and launches its loop as a detached task. Null when the
 * story is already developing — the check and the claim are one synchronous Map
 * operation, so two racing taps of the wand cannot both win, and the loser is
 * told rather than silently billed.
 */
export function launchDeriveRun(
  opts: LaunchDeriveOpts
): { runId: string } | null {
  if (live.active.has(opts.storyId)) return null

  const run: LiveDeriveRun = {
    runId: crypto.randomUUID(),
    storyId: opts.storyId,
    storyTitle: opts.storyTitle,
    startedAt: new Date().toISOString(),
    brief: opts.brief,
    system: opts.system,
    user: opts.user,
    offlineText: opts.offlineText,
    settings: opts.settings,
    callId: null,
    textSoFar: "",
    end: null,
    discarded: false,
    upstream: new AbortController(),
    listeners: new Set(),
  }
  live.active.set(run.storyId, run)
  // Before the first byte on purpose: devices on this story attach on this
  // event and watch the prompt write itself, rather than being handed a
  // finished paragraph out of nowhere.
  publishBus({
    kind: "derive-run-started",
    storyId: run.storyId,
    runId: run.runId,
  })

  void deriveRunLoop(run).catch((err) => {
    console.error("[derive-live] run loop escaped its finally", err)
  })

  return { runId: run.runId }
}

/** Deleting a story takes its develop with it — abort, and persist nothing. */
export function discardStoryDeriveRun(storyId: string): void {
  const active = live.active.get(storyId)
  if (active) {
    active.discarded = true
    active.upstream.abort()
  }
}

async function deriveRunLoop(run: LiveDeriveRun): Promise<void> {
  const key = resolveOpenRouterKey()

  // "aborted" is the default the same way it is in the other two loops: only
  // the signal distinguishes a cut-short run from a finished one, and every
  // path that does not prove otherwise was cut short. No hard timeout, also
  // like the other two — a ceiling here would be a second, invisible way for a
  // develop to fail, and the abort signal already covers the case that
  // actually happens (the story going away).
  let status: SettledCallStatus = "aborted"
  let errorMessage: string | null = null
  let usage: {
    generationId: string | null
    costUsd: number | null
    promptTokens: number | null
    completionTokens: number | null
  } | null = null

  const fanOut = (event: DeriveRunWireEvent) => {
    for (const listener of run.listeners) {
      try {
        listener(event)
      } catch {
        // A throwing subscriber is a broken socket, not a broken run.
      }
    }
  }

  /** Folded into the snapshot BEFORE the fan-out, so an attacher sees every
   *  increment exactly once — in its frame or live, never neither. */
  const emit = (value: string) => {
    run.textSoFar += value
    fanOut({ type: "text", value })
  }

  try {
    if (!key) {
      // Offline: the same run, the same frames, the same settle. The composer
      // cannot tell the two apart and nothing downstream has a second code
      // path. It costs nothing and so opens no ledger row — see the note in
      // lib/images/live.ts for why a null-cost row would be worse than none.
      for (const chunk of chunkText(run.offlineText, 2)) {
        if (run.upstream.signal.aborted) break
        emit(chunk)
        await new Promise((resolve) =>
          setTimeout(resolve, OFFLINE_CHUNK_DELAY_MS)
        )
      }
      status = run.upstream.signal.aborted ? "aborted" : "ok"
      return
    }

    // Opened BEFORE the provider call so a failed or discarded develop still
    // leaves its trace. Its own request kind, so image-prompt spend stays
    // separable from prose spend on the usage page.
    run.callId = crypto.randomUUID()
    await recordCallStarted({
      id: run.callId,
      storyId: run.storyId,
      origStoryId: run.storyId,
      storyTitle: run.storyTitle,
      requestKind: "illustrate-prompt",
      modelId: run.settings.modelId,
      // Forced off in streamDerivation, and recorded as what actually
      // happened rather than as what the story's settings say.
      thinking: "off",
      providerName: run.settings.providerTag,
    })

    try {
      for await (const event of streamDerivation({
        system: run.system,
        user: run.user,
        settings: run.settings,
        key,
        signal: run.upstream.signal,
      })) {
        if (event.type === "text" && event.value) {
          emit(event.value)
        } else if (event.type === "done") {
          usage = {
            generationId: event.generationId ?? null,
            costUsd: event.costUsd ?? null,
            promptTokens: event.promptTokens ?? null,
            completionTokens: event.completionTokens ?? null,
          }
        }
      }
      status = run.upstream.signal.aborted ? "aborted" : "ok"
    } catch (err) {
      if (run.upstream.signal.aborted) {
        status = "aborted"
      } else {
        status = "error"
        errorMessage = mapOpenRouterError(err).message
      }
    }
  } finally {
    await finishDeriveRun(run, status, errorMessage, usage)
  }
}

/**
 * The single settle path: persist the lane, settle the ledger, end, linger —
 * the same order as the image side's finishImageRun, for the same reason. The
 * end frame goes out only after the draft row committed and its `draft` event
 * is already on the bus, so a device unlocking its composer on `end` unlocks it
 * over text it has already been handed.
 */
async function finishDeriveRun(
  run: LiveDeriveRun,
  status: SettledCallStatus,
  errorMessage: string | null,
  usage: {
    generationId: string | null
    costUsd: number | null
    promptTokens: number | null
    completionTokens: number | null
  } | null
): Promise<void> {
  const settled = run.textSoFar.trim()

  // Only a completed develop with words in it writes the lane. An aborted or
  // failed one leaves the draft row exactly as the writer left it — a half
  // sentence is not a prompt, and a discarded run's story is being deleted.
  if (status === "ok" && settled !== "" && !run.discarded) {
    try {
      await persistDerivedLane(run.storyId, settled)
    } catch (err) {
      console.error("[derive-live] draft write failed", err)
    }
  }

  if (run.callId) {
    await settleCall(run.callId, {
      status,
      generationId: usage?.generationId ?? null,
      // Cut short before the final chunk: real tokens were billed and no usage
      // ever arrived, so the row settles with a NULL cost rather than a zero.
      // reconcileCall can still fill it in later from the generation id.
      usage:
        usage === null
          ? null
          : {
              promptTokens: usage.promptTokens ?? 0,
              completionTokens: usage.completionTokens ?? 0,
              reasoningTokens: 0,
              costUsd: usage.costUsd,
              cachedPromptTokens: null,
              upstreamPromptCostUsd: null,
              upstreamCompletionCostUsd: null,
              isByok: null,
            },
    })
  }

  const end: DeriveRunEndFrame = {
    type: "end",
    status,
    text: settled,
    error: status === "error" ? errorMessage : null,
  }

  // One synchronous block from here to the fan-out — an attacher lands before
  // or after, never between.
  run.end = end
  live.active.delete(run.storyId)
  live.lingering.set(run.runId, run)
  // Deliberately no `run-ended`: that event feeds the library's status marks,
  // and a develop is not a passage landing. Marking a story "done" because
  // somebody wrote a caption for it would be a lie the sidebar tells all day.
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

/**
 * Writes the settled prompt into the story's draft row and announces it.
 *
 * The update touches the LANE and nothing else. The row is the whole composer —
 * the brief, the armed move, the style — and this run is entitled only to the
 * part it produced; a keystroke that landed while the model was writing keeps
 * its text. Which is also why the event is published from the RETURNED row
 * rather than from anything read beforehand: an adopting device writes the
 * payload straight into its composer, so the payload has to be the row as it
 * now stands, not the row as it stood a moment before the write.
 *
 * The insert branch is the develop that was the first thing done in a story —
 * the wand on an untouched composer. Its values are what that composer is
 * showing: no brief, armed for Image, which is the only mode that can have got
 * here, and assistance on, which is what develops in the first place.
 */
async function persistDerivedLane(
  storyId: string,
  imagePrompt: string
): Promise<void> {
  const db = await getDb()
  const version = new Date().toISOString()

  const row = await db
    .insert(composerDrafts)
    .values({
      storyId,
      text: "",
      mode: "image",
      imagePrompt,
      imageAssisted: true,
      imageStyle: null,
      updatedAt: version,
    })
    .onConflictDoUpdate({
      target: composerDrafts.storyId,
      set: { imagePrompt, updatedAt: version },
    })
    .returning()
    .then((rows) => rows[0])
  // The story was deleted between the guard above and this write; the FK would
  // have thrown, so an empty return is the impossible case rather than a
  // silent one. Nothing to announce either way.
  if (row === undefined) return

  publishBus({
    kind: "draft",
    storyId,
    text: row.text,
    mode: row.mode,
    imagePrompt: row.imagePrompt,
    imageAssisted: row.imageAssisted,
    imageStyle: row.imageStyle,
    version: row.updatedAt,
    origin: SERVER_DRAFT_ORIGIN,
  })
}
