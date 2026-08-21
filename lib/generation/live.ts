// lib/generation/live.ts — The process-global registry of live generation runs.
//
// The server owns every generation now. A run is launched as a detached task —
// a floating promise tied to no request — because the request that started it
// is the first thing that can die: a closed tab, a sleeping phone, a network
// blip. Clients are pure subscribers; detaching one removes a listener and
// nothing else, and only stopRun() (via the stopGeneration action) aborts the
// model.
//
// It is also the spend recorder, for the one reason that decides where such a
// thing can live: every other candidate only runs when the generation SUCCEEDS.
// A stopped stream and a provider error are both billed and neither leaves a
// passage behind, so the ledger row is opened here before the first byte and
// settled on the single path every ending passes through.
import "server-only"

import { eq } from "drizzle-orm"

import { getDb } from "@/lib/db/client"
import { persistGeneratedEntry } from "@/lib/db/entry-writes"
import { stories } from "@/lib/db/schema"
import { recordCallStarted, settleCall } from "@/lib/generation/calls"
import { resolveOpenRouterKey } from "@/lib/generation/key"
import { MockGenerationProvider } from "@/lib/generation/mock-provider"
import {
  mapOpenRouterError,
  streamCompletion,
} from "@/lib/generation/openrouter"
import { reconcileCall, shouldReconcile } from "@/lib/generation/reconcile"
import {
  invalidateAccountZdrPolicy,
  isDataPolicyRefusal,
} from "@/lib/generation/zdr-account"
import type {
  ComposedContext,
  GenerationEvent,
  GenerationUsage,
} from "@/lib/generation/types"
import { publishBus, touchStory } from "@/lib/sync/bus"
import type { RunEndFrame, RunFrame, RunWireEvent } from "@/lib/sync/types"
import {
  zdrGroupForModel,
  type EntryGeneration,
  type GenerationRequestKind,
  type GenerationSettings,
  type SettledCallStatus,
} from "@/lib/types"

/** How long a finished run stays addressable, so a subscriber racing the finish still gets snapshot + end. */
const LINGER_MS = 60_000

type RunListener = (event: RunWireEvent) => void

export interface LiveRun {
  readonly runId: string
  readonly storyId: string
  readonly requestKind: GenerationRequestKind
  /** The writer's persisted turn row, or null for Continue/Retry. */
  readonly userEntryId: string | null
  /** Ids this run supersedes (a Retry's outgoing take) — echoed to late attachers. */
  readonly removingEntryIds: readonly string[]
  /**
   * Doubles as the start token: a bare Stop (no runId — the caller's own start
   * is still in flight) carries the turnId that start minted, and only a run
   * or reservation holding the same one may be aborted by it. See stopRun.
   */
  readonly turnId: string | null
  readonly variantGroupId: string | undefined
  readonly settings: GenerationSettings
  /**
   * The profile the settings above came from, or null for a story's own Custom
   * columns. Carried separately because `settings` is the resolved bundle and
   * says nothing about where it came from — and the take this run persists is
   * the only place that provenance is ever written down.
   */
  readonly profileName: string | null
  /** The ledger row, once one is opened. Stays null on the offline mock. */
  callId: string | null
  /** The snapshot: everything streamed so far, compressed. */
  text: string
  reasoningChars: number
  usage: GenerationUsage | null
  /** Set exactly once, after the persist committed — a finished run IS its end frame. */
  end: RunEndFrame | null
  /**
   * True when the story itself is being deleted out from under the run. The
   * abort is the same as a Stop, but the settle path must not persist into a
   * manuscript that no longer exists — and must not call that an error.
   */
  discarded: boolean
  readonly upstream: AbortController
  readonly listeners: Set<RunListener>
}

/**
 * Held on globalThis the same way the pg pool is (see lib/db/client.ts): dev
 * HMR re-evaluates this module while detached run loops and open SSE routes
 * keep executing against the old copy, and two registries means a run nobody
 * can find or stop.
 */
const globalForLive = globalThis as unknown as {
  __draftZeroLive?: {
    /** Keyed by storyId — one active run per story is the concurrency rule. */
    active: Map<string, LiveRun>
    /** Finished runs by runId, kept for LINGER_MS then GC'd. */
    lingering: Map<string, LiveRun>
    /**
     * Stories claimed by a startGeneration that hasn't launched yet, mapped to
     * that start's turnId — the token a bare Stop must present to latch
     * against the reservation (see stopRun).
     */
    reserved: Map<string, string | null>
    /**
     * Stories whose reservation was told to stop before launchRun registered a
     * run to abort. A Stop pressed during the start round-trip has nothing to
     * act on server-side yet; latching it here (instead of in the pressing
     * tab, which can die) lets launchRun abort the run at birth.
     */
    stopRequested: Set<string>
    /**
     * Stories deleted moments ago. A deleteStory can race a startGeneration
     * whose POST is still in flight: discardStoryRun finds neither a run nor a
     * reservation, then the start reserves, reads a story the delete hasn't
     * committed away yet, and launches a run that streams and bills into a
     * manuscript that is already gone. The tombstone makes reserveRun refuse
     * instead. Ids are never reused, so expiry is about memory, not
     * correctness.
     */
    tombstoned: Set<string>
  }
}

/** How long a deleted story's id refuses new reservations — comfortably past the delete's own commit. */
const TOMBSTONE_MS = 30_000

const live = (globalForLive.__draftZeroLive ??= {
  active: new Map(),
  lingering: new Map(),
  reserved: new Map(),
  stopRequested: new Set(),
  tombstoned: new Set(),
})
// Older HMR copies of the registry predate these shapes; heal in place rather
// than replacing the object every other module closure already holds.
// `reserved` was a Set before it learned to carry the start's token.
if (!(live.reserved instanceof Map)) live.reserved = new Map()
live.stopRequested ??= new Set()
live.tombstoned ??= new Set()

/**
 * The run a subscriber may attach to, or null (the route answers 204).
 *
 * A bare storyId finds only the ACTIVE run: a fresh page probing "is anything
 * running?" must not adopt a run that already ended and re-live its finish. A
 * named runId also reaches the linger map — that caller was told about this
 * specific run and deserves its end frame even if it lost the race.
 */
export function findRun(
  storyId: string,
  runId?: string | null
): LiveRun | null {
  const active = live.active.get(storyId)
  if (active && (!runId || active.runId === runId)) return active
  if (runId) {
    const lingered = live.lingering.get(runId)
    if (lingered && lingered.storyId === storyId) return lingered
  }
  return null
}

export function isRunActive(storyId: string): boolean {
  return live.active.has(storyId) || live.reserved.has(storyId)
}

/**
 * Claims the story's one run slot BEFORE anything is written. startGeneration
 * awaits several times between its busy check and launchRun — the turn persist,
 * the model catalog, context composition — and two devices pressing Send in
 * that window would otherwise both persist a turn and then one of them would
 * lose the launch, leaving an orphaned row and a "restored" draft that
 * duplicates it. Reserving synchronously up front makes the busy answer and the
 * claim the same Map/Set operation, so the loser fails before writing anything.
 *
 * Returns false when the story is already reserved or running — or freshly
 * deleted (tombstoned): a start racing a deleteStory must fail here rather
 * than launch a run into a manuscript that is already gone. The holder MUST
 * release (releaseRun) on every path — launchRun does not consume the
 * reservation, it just wins the slot while the reservation still guards it.
 *
 * `startToken` is the start's turnId, kept so a bare Stop can prove the
 * reservation it wants latched is its own (see stopRun).
 */
export function reserveRun(
  storyId: string,
  startToken: string | null = null
): boolean {
  if (
    live.tombstoned.has(storyId) ||
    live.active.has(storyId) ||
    live.reserved.has(storyId)
  ) {
    return false
  }
  live.reserved.set(storyId, startToken)
  return true
}

export function releaseRun(storyId: string): void {
  live.reserved.delete(storyId)
  // A start that failed before launching leaves nothing to stop; a latched
  // stop surviving it would abort the story's NEXT run at birth.
  if (!live.active.has(storyId)) live.stopRequested.delete(storyId)
}

export interface RunAttachment {
  /** The snapshot frame — always the subscriber's first line. */
  frame: RunFrame
  /** Present when the run already finished: snapshot + end is the whole story. */
  end: RunEndFrame | null
  detach: () => void
}

/**
 * Builds the snapshot and adds the listener in one synchronous pass — no await
 * between them, so no event can fall in the gap between "state so far" and
 * "events from now on". Single-threaded JS is the whole locking story.
 */
export function attachRun(run: LiveRun, listener: RunListener): RunAttachment {
  const frame: RunFrame = {
    type: "run",
    runId: run.runId,
    storyId: run.storyId,
    requestKind: run.requestKind,
    userEntryId: run.userEntryId,
    removingEntryIds: [...run.removingEntryIds],
    reasoningChars: run.reasoningChars,
    text: run.text,
  }
  run.listeners.add(listener)
  return {
    frame,
    end: run.end,
    detach: () => run.listeners.delete(listener),
  }
}

export interface LaunchOpts {
  storyId: string
  requestKind: GenerationRequestKind
  userEntryId: string | null
  removingEntryIds: string[]
  turnId: string | null
  variantGroupId?: string
  context: ComposedContext
  settings: GenerationSettings
  profileName: string | null
}

/**
 * Registers the run and launches its loop as a detached task. Returns null when
 * the story already has one — the claim and the check are the same synchronous
 * Map operation, so two racing starts cannot both win.
 *
 * Deliberately NOT `after()`: that ties the work to a request lifetime, and
 * outliving the request is the entire point.
 */
export function launchRun(opts: LaunchOpts): { runId: string } | null {
  if (live.active.has(opts.storyId)) return null

  const run: LiveRun = {
    runId: crypto.randomUUID(),
    storyId: opts.storyId,
    requestKind: opts.requestKind,
    userEntryId: opts.userEntryId,
    removingEntryIds: opts.removingEntryIds,
    turnId: opts.turnId,
    variantGroupId: opts.variantGroupId,
    settings: opts.settings,
    profileName: opts.profileName,
    callId: null,
    text: "",
    reasoningChars: 0,
    usage: null,
    end: null,
    discarded: false,
    upstream: new AbortController(),
    listeners: new Set(),
  }
  live.active.set(run.storyId, run)
  // A Stop that landed while this run was still a reservation finally has its
  // target: abort at birth, before the provider is ever reached, and the loop
  // settles it "aborted" like any other Stop.
  if (live.stopRequested.delete(opts.storyId)) run.upstream.abort()
  // Before the first token on purpose: devices on this story attach on this
  // event and ride the whole run instead of arriving mid-paragraph.
  publishBus({ kind: "run-started", storyId: run.storyId, runId: run.runId })

  // The floating promise. runLoop routes every ending through finishRun, so a
  // rejection escaping here would be a bug — but an unhandled rejection takes
  // the whole process down, and the process is holding everyone's runs.
  void runLoop(run, opts.context).catch((err) => {
    console.error("[live] run loop escaped its finally", err)
  })

  return { runId: run.runId }
}

/**
 * The only way a generation is ever aborted. Any device may call it; a no-op
 * when nothing is running. The loop sees the signal, returns, and lands in the
 * same settle path a completed run does — trimmed prose persists.
 *
 * `runId` names the run the caller was watching. A stale device's Stop must
 * kill that run and only that run — keyed by story alone it would abort
 * whatever is active NOW, which after a settle-and-restart is someone else's
 * fresh run. Null means the caller's own start is still in flight (no runId
 * has reached it yet), and `startToken` — the turnId that start minted — is
 * what proves the slot is really that start's: a device that missed another
 * device's run-started (hidden tab, dead socket) can press Send under a live
 * foreign run, and its Stop must not abort a run it never owned. So a bare
 * stop only aborts the active run carrying the same turnId, and only latches
 * the reservation holding the same token; anything else is a no-op — the
 * caller's own start fails BUSY and nothing else is disturbed.
 */
export function stopRun(
  storyId: string,
  runId?: string | null,
  startToken?: string | null
): void {
  const token = startToken ?? null
  const active = live.active.get(storyId)
  if (active) {
    if (runId != null ? active.runId === runId : active.turnId === token) {
      active.upstream.abort()
    }
    return
  }
  if (runId == null && live.reserved.get(storyId) === token) {
    live.stopRequested.add(storyId)
  }
}

/**
 * Deleting a story takes its run with it. Same abort as a Stop, but the prose
 * is deliberately not persisted: the manuscript it belongs to is going, and a
 * refused persist into it would end the run "error" — a toast about losing a
 * passage the writer just chose to delete.
 */
export function discardStoryRun(storyId: string): void {
  // Tombstoned unconditionally: a start whose POST hasn't reached reserveRun
  // yet has nothing here to abort OR latch, and without this it would reserve
  // moments from now and launch into the deleted story. reserveRun refuses
  // tombstoned ids for TOMBSTONE_MS — long past any in-flight start.
  live.tombstoned.add(storyId)
  const timer = setTimeout(() => live.tombstoned.delete(storyId), TOMBSTONE_MS)
  timer.unref?.()

  const active = live.active.get(storyId)
  if (active) {
    active.discarded = true
    active.upstream.abort()
    return
  }
  // A start still inside its reservation launches into a deleted story; the
  // latched stop aborts it at birth before any prose exists to lose.
  if (live.reserved.has(storyId)) live.stopRequested.add(storyId)
}

/**
 * The shared refusal for mutators that must not land under a live generation:
 * an edit or delete rewrites or deactivates the very slot the run persists
 * into, and the history walkers truncate the redo tail out from under the
 * run's own recordOp. One helper, so a future mutator cannot forget the check.
 * Null when the story is free to write.
 */
export function refuseDuringRun(
  storyId: string
): { ok: false; error: string } | null {
  if (!isRunActive(storyId)) return null
  return {
    ok: false,
    error: "A generation is running for this story — wait for it to finish.",
  }
}

/**
 * The story this call is billed to, or null.
 *
 * A story that vanished mid-flight still streams: the writer asked for prose
 * and a bookkeeping miss is not their problem. It is recorded with a null
 * story_id rather than dropped, because a cost is a cost — the global view is
 * built to read those rows.
 */
async function resolveStory(
  storyId: string
): Promise<{ id: string; title: string } | null> {
  try {
    const db = await getDb()
    const row = await db
      .select({ id: stories.id, title: stories.title })
      .from(stories)
      .where(eq(stories.id, storyId))
      .limit(1)
      .then((rows) => rows[0])
    return row ?? null
  } catch {
    return null
  }
}

async function runLoop(run: LiveRun, context: ComposedContext): Promise<void> {
  const key = resolveOpenRouterKey()

  // Aborted is the default, not the exception. A Stop does not throw anywhere:
  // both providers RETURN the moment their signal trips, so the `for await`
  // below ends exactly as a finished generation does. Only the signal itself
  // tells the two apart, and every path that does not prove otherwise is a
  // call that was cut short.
  let status: SettledCallStatus = "aborted"
  let errorMessage: string | null = null
  let generationId: string | null = null

  const fanOut = (event: RunWireEvent) => {
    for (const listener of run.listeners) {
      try {
        listener(event)
      } catch {
        // A throwing subscriber is a broken socket, not a broken run.
      }
    }
  }

  // Folds each provider event into the snapshot BEFORE fanning it out, so a
  // subscriber attaching between two events sees each byte exactly once —
  // either compressed into its snapshot frame or live, never both or neither.
  const forward = (event: GenerationEvent) => {
    if (event.type === "meta") {
      // Server bookkeeping, never on the wire: the client has no ledger to
      // link anymore, and the generation id only matters to reconciliation.
      generationId = event.generationId
      return
    }
    if (event.type === "reasoning") run.reasoningChars += event.chars
    if (event.type === "text") run.text += event.value
    if (event.type === "usage") run.usage = event.usage
    fanOut(event)
  }

  try {
    if (key !== null) {
      const gen = streamCompletion({
        context,
        settings: run.settings,
        key,
        signal: run.upstream.signal,
        // One story, one upstream provider — see streamCompletion.
        sessionId: run.storyId,
      })

      // Pull the first event BEFORE opening the ledger row: auth/credit/rate
      // errors throw before the first yield, and a request that never reached
      // a provider was never billed.
      let first: IteratorResult<GenerationEvent>
      try {
        first = await gen.next()
      } catch (err) {
        // A Stop can land in this window too — the fetch throws its abort
        // before the first byte — and a deliberate Stop must not fan out as an
        // error toast on every device. Same signal check as the mid-stream
        // catch below.
        if (run.upstream.signal.aborted) return
        // A request this app made no data-policy demand of, refused on
        // data-policy grounds, can only have been refused by the ACCOUNT — and
        // whatever the cached answer about that account says, it just turned
        // out to be wrong. Dropping it makes the next reader re-probe; the
        // probe, not this failure, gets to say what replaced it.
        if (!run.settings.zdr && isDataPolicyRefusal(err)) {
          invalidateAccountZdrPolicy(zdrGroupForModel(run.settings.modelId))
        }
        status = "error"
        errorMessage = mapOpenRouterError(err).message
        return
      }

      const story = await resolveStory(run.storyId)
      run.callId = crypto.randomUUID()
      await recordCallStarted({
        id: run.callId,
        storyId: story?.id ?? null,
        origStoryId: run.storyId,
        storyTitle: story?.title ?? null,
        requestKind: run.requestKind,
        modelId: run.settings.modelId,
        thinking: run.settings.thinking ?? null,
        providerName: run.settings.providerTag ?? null,
      })

      try {
        if (!first.done) forward(first.value)
        for await (const event of gen) forward(event)
        status = run.upstream.signal.aborted ? "aborted" : "ok"
      } catch (err) {
        if (run.upstream.signal.aborted) {
          // The writer pressed Stop while a chunk was in flight. Tokens were
          // billed; nothing failed.
          status = "aborted"
        } else {
          // Mid-stream failure: the partial prose still persists below (same
          // "keep what streamed" semantics as Stop) and the end frame carries
          // the message worth a toast.
          status = "error"
          errorMessage = mapOpenRouterError(err).message
        }
      }

      // Settled here, on the loop's one exit, so there is exactly one settle
      // per run — a disconnecting subscriber cannot record a second row or
      // skip this one, because subscribers no longer sit on this path at all.
      await settleCall(run.callId, {
        status,
        generationId,
        usage: run.usage,
      })
      // Only for a call that never finished: a completed one already told us
      // its cost on the final chunk, and asking again would buy nothing.
      // Fire-and-forget — reconciliation backs off across ~15s and the writer's
      // end frame must not wait on a measurement.
      if (shouldReconcile(status, generationId)) {
        void reconcileCall(run.callId, generationId, key)
      }
    } else {
      // No key → the offline mock, resolved here and nowhere else. It records
      // no ledger row and claims no generation id: nothing was billed, and a
      // plausible-looking id would be a lie the reconciler could act on.
      const provider = new MockGenerationProvider()
      try {
        for await (const event of provider.generate({
          context,
          settings: run.settings,
          signal: run.upstream.signal,
        })) {
          forward(event)
        }
        status = run.upstream.signal.aborted ? "aborted" : "ok"
      } catch {
        status = "error"
        errorMessage = "Generation failed. Try again."
      }
    }
  } finally {
    await finishRun(run, status, errorMessage)
  }
}

/**
 * The single settle path: persist, announce, end, linger — in that order.
 *
 * The end frame is emitted only AFTER the persist committed, so `entryId` is a
 * fact by the time any client acts on it, and touchStory rides between the two
 * so passive devices refetch a tree the row is already in.
 */
async function finishRun(
  run: LiveRun,
  status: SettledCallStatus,
  errorMessage: string | null
): Promise<void> {
  let entryId: string | null = null
  let persistFailed = false
  const trimmed = run.text.trim()
  // Stop and mid-stream error keep their partial prose — the writer's
  // half-finished passage is worth more than tidiness about how it ended.
  // Empty text persists nothing: there is no such thing as a blank passage.
  // A discarded run persists nothing either: its manuscript is being deleted,
  // and the refusal that persist would earn is not an error worth a toast.
  if (trimmed !== "" && !run.discarded) {
    const generation: EntryGeneration = {
      modelId: run.settings.modelId,
      thinking: run.settings.thinking,
      temperature: run.settings.temperature,
      profileName: run.profileName,
      promptTokens: run.usage?.promptTokens ?? null,
      completionTokens: run.usage?.completionTokens ?? null,
    }
    try {
      const persisted = await persistGeneratedEntry(run.storyId, trimmed, {
        turnId: run.turnId,
        variantGroupId: run.variantGroupId,
        generation,
        callId: run.callId,
      })
      if (persisted.ok) {
        entryId = persisted.data.entry.id
      } else {
        // The slot vanished, or the story did. The prose is gone with it —
        // logged because losing text should never be silent on the server,
        // even when refusing was the right call.
        console.error("[live] persist refused:", persisted.error)
        persistFailed = true
      }
    } catch (err) {
      console.error("[live] persist failed", err)
      persistFailed = true
    }
  }

  // Streamed prose that could not be saved must not end "ok": a clean status
  // with a null entryId is exactly what a legitimately empty completion looks
  // like, and the client would silently clear the passage off every screen.
  // Tokens were billed and text was lost — that is an error, and it gets the
  // toast an error gets.
  const end: RunEndFrame = {
    type: "end",
    status: persistFailed ? "error" : status,
    entryId,
    error: persistFailed
      ? "Generation finished but the passage couldn't be saved."
      : status === "error"
        ? errorMessage
        : null,
    usage: run.usage,
  }

  // One synchronous block from here to the fan-out: the run becomes findable
  // as finished (linger map, end frame set) in the same tick the end frame is
  // delivered, so an attacher can land before OR after but never between.
  run.end = end
  live.active.delete(run.storyId)
  live.lingering.set(run.runId, run)
  // Before the end frame on purpose: by the time the origin device settles,
  // every passive device has already been told the tree moved.
  touchStory(run.storyId)
  for (const listener of run.listeners) {
    try {
      listener(end)
    } catch {
      // Same bargain as fanOut: a dead socket must not mute the rest.
    }
  }
  run.listeners.clear()

  const timer = setTimeout(() => live.lingering.delete(run.runId), LINGER_MS)
  // A lingering run must not hold the process open — tests and graceful
  // shutdown both want to exit before the linger window closes.
  timer.unref?.()
}
