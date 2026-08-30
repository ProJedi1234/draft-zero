"use client"

// hooks/use-generation.ts — The single owner of story generation STATE.
//
// The generation itself now lives on the server: startGeneration persists the
// writer's turn, launches the provider loop as a detached task, and returns a
// runId; the server persists the finished passage and only then emits the
// terminal frame. This hook is a subscriber — it renders where the run IS and
// watches it move, exactly like every other device on the story. Closing the
// subscribe stream detaches a listener and nothing else; stopGeneration() is
// the only way to abort the model, which is why a dead tab no longer kills a
// passage mid-sentence.
//
// A retry no longer destroys anything: the server deactivates the old take as
// it inserts the new one, so the old take leaves `story.entries` exactly as a
// deleted row used to — which is why the optimistic-hide machinery below needed
// no changes for it.
//
// Everything the canvas shows ahead of the server — the echoed player turn, the
// streamed passage, the entries a retry is about to delete — is held until the
// server's own version of it is *observably* present in `story.entries`, and is
// dropped by a derivation off that array rather than by a setState timed to
// land in the same commit. Timing them was the old design and it is what made
// the finished passage flicker: a server action's revalidated tree and this
// hook's own state updates are two separate commits, in an order React does not
// promise, so the streamed block either blinked out for a frame (clear first) or
// briefly rendered twice (tree first). Deriving from the data cannot race —
// whichever commit carries the real row is, by construction, the commit that
// stops rendering the stand-in.
//
// startGeneration doesn't revalidate (the writer is waiting on it before a
// single token appears), so `syncRef` tracks the window where a persisted
// player turn exists that the client hasn't been handed yet, and every terminal
// path refreshes the tree if it is still open.

import * as React from "react"
import { toast } from "sonner"

import {
  startGeneration,
  stopGeneration,
  syncStoryTree,
} from "@/lib/actions/generation"
import { redoStoryOp, undoStoryOp } from "@/lib/actions/history"
import type { GenerationUsage } from "@/lib/generation/types"
import { randomId } from "@/lib/id"
import { translateAction } from "@/lib/story/action-voice"
import { liveRuns, localRefresh, subscribeRun } from "@/lib/sync/client"
import type {
  ActiveRun,
  RunEndFrame,
  RunFrame,
  RunWireEvent,
} from "@/lib/sync/types"
import type {
  ActionKind,
  ActionResult,
  GenerationRequestKind,
  Story,
} from "@/lib/types"

/**
 * `thinking` is the window where the model is reasoning and has produced no
 * prose yet. It is distinct from `pending` — which now means only "the request
 * is in flight and nothing has come back" — because those two look identical to
 * a writer and are not the same thing at all: one of them is progress and the
 * other might be a stall.
 *
 * `settling` is the window between the last token and the persisted row
 * arriving: the prose is finished and final, still rendered from the local
 * buffer, and no longer stoppable.
 */
export type GenerationStatus =
  "idle" | "pending" | "thinking" | "streaming" | "settling"

const GENERATION_ERROR = "Generation failed. Try again."
const UNDO_ERROR = "Couldn't undo the last change."
const REDO_ERROR = "Couldn't redo that change."

/**
 * How long to wait for a revalidated tree before giving up on it. Only reached
 * if a revalidation is lost or the page never re-renders; without it the writer
 * would be locked out of the composer for good.
 */
const SETTLE_TIMEOUT_MS = 6000

/**
 * How long to leave a cut-short generation before refetching the tree.
 *
 * A stop is the one case whose cost does not arrive with the stream — usage
 * rides the final chunk and there isn't one — so the server goes and asks
 * OpenRouter for it afterwards, backing off 1s/4s/10s (lib/generation/
 * reconcile.ts) and writing straight to Postgres. Nothing pushes that write
 * back down. Without this the passage's chip keeps reading "—", the story total
 * stays short and the ledger keeps a "not recorded" footnote, until the writer
 * happens to navigate away and back — which is to say, the one case
 * reconciliation exists for is the one case its result was never visible in.
 *
 * One refresh, just past the far end of that backoff. It is not on the writer's
 * path: it lands long after the passage has settled and repaints nothing but a
 * number they have not asked to see yet.
 */
const RECONCILE_SETTLE_MS = 17_000

/**
 * Re-attach cadence after the subscribe socket dies under a live run. Short and
 * flat rather than the sync channel's 1s/2s/5s: the caret is visibly frozen for
 * exactly this long, and the snapshot frame makes every re-attach lossless, so
 * eagerness costs nothing but a cheap 204.
 */
const REATTACH_BACKOFF_MS = [500, 1000, 2000]

/**
 * Where the ladder above settles once the short rungs are spent, and it never
 * stops climbing back — the reader has no give-up state at all.
 *
 * It used to have one: five consecutive failures and the loop returned for
 * good, on the reasoning that a subscribe failing outright is not a blip. The
 * flaw is what "for good" meant. The comment promised the sync channel's
 * reconnect probe would re-attach, but that probe only fires when the SYNC
 * socket reconnects — and the ordinary case is the sync socket never dropping
 * at all, because only the subscribe request failed. So six seconds of trouble
 * detached a device from a live run permanently: the sidebar went on counting
 * "writing · 1m 13s", the subscribe route went on answering 200, and the
 * workspace sat idle under it until the writer navigated away and back.
 *
 * A run this device cannot reach is still running. The only things allowed to
 * end it locally are ANSWERS — a 204, or a terminal frame — never a failure to
 * ask the question.
 */
const REATTACH_IDLE_BACKOFF_MS = 10_000

/**
 * Consecutive subscribe failures before the writer is told. Not a give-up (see
 * above): below this a blip has fixed itself before anyone could finish
 * reading a toast, and past it the caret has been visibly frozen for seconds,
 * which is too long to say nothing.
 */
const SUBSCRIBE_FAILURE_NOTICE = 4

/** What the server calls a generation that arrived with no move attached. */
const DEFAULT_REQUEST_KIND: GenerationRequestKind = "generate"

/** The player's turn, shown from here until its own row lands. */
type Echo = {
  text: string
  /** Null until startGeneration comes back — i.e. while unacknowledged. */
  entryId: string | null
}

interface StartOptions {
  /** Which move the writer made. Omitted for Continue and Retry, which append nothing. */
  kind?: ActionKind
  /** The raw first-person text the writer typed; the server translates and persists it. */
  userText?: string
  /** Echoed locally until revalidation delivers the persisted passage. */
  echo?: string
  /**
   * Retries only: the slot the finished passage joins as a new take. Used at
   * both ends — the context is composed with this slot excluded so the model
   * writes an alternative rather than a continuation, and the insert then
   * deactivates the slot's current take in the same transaction. The retry
   * seed is the server's business: it derives the take ordinal from the slot
   * itself, which a per-tab counter cannot see across devices.
   */
  variantGroupId?: string
  /** Entry ids hidden locally until the deactivated take stops being delivered. */
  removing?: string[]
  /** Which move this is, recorded on the spend ledger row. */
  requestKind?: GenerationRequestKind
  /** Run this one passage under a named profile; see startGeneration. */
  profileId?: string
  /** Composer text to hand back if the dispatch fails before the server owns it. */
  restoreOnFailure?: string
}

export interface GenerationController {
  status: GenerationStatus
  /** True while any generation or entry mutation is in flight. */
  busy: boolean
  /** In-flight prose, and then the finished passage until its row lands. */
  streamingText: string
  /**
   * Exact token counts for the last COMPLETED generation, or null before one has
   * finished. Only ever set from the run's `usage` event — never estimated — so
   * a caller can render it as an authoritative figure. The same counts are
   * persisted onto the row server-side, which is what the variant switcher's
   * provenance tooltip reads; this stays for anything that wants them live.
   */
  usage: GenerationUsage | null
  /** User passage echoed locally while the server round-trip runs. */
  optimisticUserText: string | null
  /** True while that echo is still unacknowledged by the server. */
  optimisticUserPending: boolean
  /** Entries hidden locally ahead of the server (the take a retry replaces). */
  removingEntryIds: string[]
  canUndo: boolean
  canRedo: boolean
  canRetry: boolean
  /** "Undo · Retry" when the story knows what ⌘Z reverses, else plain "Undo". */
  undoLabel: string
  /** Likewise for ⌘⇧Z. */
  redoLabel: string
  /** Returns true when the text was accepted (composer clears on true). */
  send: (text: string, kind: ActionKind) => boolean
  continueStory: () => void
  /**
   * Regenerates the last passage. `profileId` runs this take under that profile
   * instead of the story's settings, for this take only — omit it for the plain
   * retry. Never wire this straight to an onClick: the event would arrive as
   * the id.
   */
  retryLast: (profileId?: string) => void
  undo: () => void
  redo: () => void
  stop: () => void
}

export interface GenerationOptions {
  /**
   * Called with text that the composer cleared optimistically but that the
   * server never took ownership of. Both Say and Do clear the composer the
   * instant they dispatch, so if the append or start step fails there is no
   * other copy of the writer's words anywhere — the row was never inserted and
   * the textarea is already empty. This hands them back verbatim (untrimmed, as
   * typed) instead of destroying them.
   */
  onRestoreDraft?: (text: string) => void
  /**
   * Written BY the hook, read by whoever holds the sync channel: calling it
   * with a runId (from a `run-started` event) attaches this device to that run
   * mid-flight. A ref rather than a return-value method because the
   * GenerationController surface is the writer's controls, and "another device
   * started something" is not one of them. Null is the re-probe — "did I miss
   * a run-started while my socket was down?" — fired on sync reconnect.
   */
  attachRef?: { current: ((runId: string | null) => void) | null }
}

export function useGeneration(
  story: Story,
  options: GenerationOptions = {}
): GenerationController {
  const storyId = story.id
  const entries = story.entries

  const optionsRef = React.useRef(options)
  React.useEffect(() => {
    optionsRef.current = options
  })

  const [status, setStatus] = React.useState<GenerationStatus>("idle")
  const [streamingText, setStreamingText] = React.useState("")
  const [usage, setUsage] = React.useState<GenerationUsage | null>(null)
  const [echo, setEcho] = React.useState<Echo | null>(null)
  const [tailEntryId, setTailEntryId] = React.useState<string | null>(null)
  const [removingEntryIds, setRemovingEntryIds] = React.useState<string[]>([])
  const [isPending, startTransition] = React.useTransition()

  // Synchronous re-entry guard: state lands a tick too late for fast clicks.
  // True from the moment this device owns or mirrors a run until it settles.
  const activeRef = React.useRef(false)
  // Aborts the SUBSCRIBE stream only — a detach, never a stop. The model does
  // not know or care that this listener left (invariant: only stopGeneration
  // aborts a generation).
  const abortRef = React.useRef<AbortController | null>(null)
  // The run this device is attached to; guards against adopting it twice when
  // the run-started event for our own start echoes back over the sync channel.
  const runIdRef = React.useRef<string | null>(null)
  // Text the composer cleared on dispatch that only this hook can give back.
  const unownedTextRef = React.useRef<string | null>(null)
  // The turnId of THIS device's own start, live from the moment start() mints
  // it until reset(). It is the token a bare Stop (runId still unknown)
  // presents server-side, so the stop can only ever reach the run or
  // reservation that start created — never a foreign run this device missed
  // the run-started for.
  const startTurnIdRef = React.useRef<string | null>(null)
  // Stop pressed while the start round-trip was still in flight. The server
  // latches that intent against the start's reservation, but the stop POST
  // can outrace the start's own reserveRun and find nothing to latch; this
  // flag makes start() re-fire the stop by name the moment the runId exists.
  const stopDuringStartRef = React.useRef(false)
  // True when THIS device started the run it is attached to. Passive mirrors
  // skip the settle refresh — the bus `change` from finishRun is theirs.
  const originRef = React.useRef(false)
  // A run-started that arrived while attach() had to refuse (mid-settle, probe
  // in flight). Drained by reset(), so the handoff is deferred, never dropped.
  const pendingAttachRef = React.useRef<string | null>(null)
  // reset() re-probes through this ref because attach() is declared below it —
  // the two genuinely call each other, and a ref breaks the cycle.
  const attachFnRef = React.useRef<((runId: string | null) => void) | null>(
    null
  )
  // True while a persisted player turn is invisible to the client, because
  // startGeneration wrote it without revalidating. Cleared by whichever
  // terminal path refreshes the tree.
  const syncRef = React.useRef(false)
  // The pending post-reconciliation refresh, if any. See RECONCILE_SETTLE_MS.
  const costRefreshRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  // Readers currently asleep in a re-attach backoff, so waking the device can
  // cut their wait short. A ref rather than state: nothing renders because a
  // reader is sleeping.
  const sleepersRef = React.useRef(new Set<() => void>())

  React.useEffect(
    () => () => {
      // Unmount detaches the listener. The run — if any — keeps going, and the
      // server persists its prose; that is the whole point of the inversion.
      // Nulled as well as aborted: dev StrictMode remounts, and a dead
      // controller left in the ref would make attach() refuse forever.
      abortRef.current?.abort()
      abortRef.current = null
      if (costRefreshRef.current !== null) clearTimeout(costRefreshRef.current)
    },
    []
  )

  const entryIds = React.useMemo(
    () => new Set(entries.map((entry) => entry.id)),
    [entries]
  )

  // The three "has the server caught up?" questions, all answered off the
  // entries array itself so the answer changes in the same commit as the data.
  const echoLanded = echo?.entryId != null && entryIds.has(echo.entryId)
  const tailLanded = tailEntryId !== null && entryIds.has(tailEntryId)
  const stillRemoving = React.useMemo(
    () => removingEntryIds.filter((id) => entryIds.has(id)),
    [entryIds, removingEntryIds]
  )

  const busy = isPending || status !== "idle"

  /**
   * The one way the re-entry slot is ever given back. Every holder must free
   * it through here, because freeing is only half the job: a run-started that
   * arrived while the slot was held (attach() had to refuse) is latched, has
   * no second delivery, and must be chased NOW — a holder that just flipped
   * activeRef would orphan it, leaving an idle composer under a live run. With
   * nothing latched this re-probes, which an idle story answers with one
   * cheap 204.
   */
  const releaseSlot = React.useCallback(() => {
    activeRef.current = false
    const pending = pendingAttachRef.current
    pendingAttachRef.current = null
    attachFnRef.current?.(pending)
  }, [])

  const reset = React.useCallback(() => {
    abortRef.current = null
    runIdRef.current = null
    originRef.current = false
    startTurnIdRef.current = null
    stopDuringStartRef.current = false
    setStatus("idle")
    setStreamingText("")
    setEcho(null)
    setTailEntryId(null)
    setRemovingEntryIds([])
    releaseSlot()
  }, [releaseSlot])

  /** Refreshes the tree if a player turn is still only on disk. */
  const syncIfOwed = React.useCallback(() => {
    if (!syncRef.current) return
    syncRef.current = false
    startTransition(async () => {
      // Gated so a bus change landing mid-refresh doesn't refresh again.
      localRefresh.pending += 1
      try {
        await syncStoryTree()
      } catch {
        // The echo is already gone or about to be; a failed refresh is not
        // worth a toast on top of whatever else went wrong.
      } finally {
        localRefresh.pending -= 1
      }
    })
  }, [])

  /**
   * Refetches the tree once the server has had time to price a stopped call.
   *
   * Only one is ever outstanding: a writer who stops three generations in a row
   * wants the last refresh, not three of them, and each one supersedes the last.
   */
  const scheduleCostRefresh = React.useCallback(() => {
    if (costRefreshRef.current !== null) clearTimeout(costRefreshRef.current)
    costRefreshRef.current = setTimeout(() => {
      costRefreshRef.current = null
      // Deliberately not in a transition: nothing is waiting on it and `busy`
      // must not flicker under a writer who has long since moved on.
      void syncStoryTree().catch(() => {
        // A cost that stays unknown for another navigation is not worth a toast.
      })
    }, RECONCILE_SETTLE_MS)
  }, [])

  const fail = React.useCallback(
    (message: string) => {
      toast.error(message)
      // The round-trip never got as far as owning this text, so hand it back to
      // the composer rather than losing what the writer typed.
      const unowned = unownedTextRef.current
      unownedTextRef.current = null
      if (unowned !== null) optionsRef.current.onRestoreDraft?.(unowned)
      syncIfOwed()
      reset()
    },
    [reset, syncIfOwed]
  )

  /**
   * The terminal frame. By the time it arrives the server has already committed
   * the persist — entryId is a fact — so everything here is display: square the
   * local buffer with the row that now exists, enter `settling`, and refresh the
   * tree so that row (and the player's turn) get delivered. Passive mirrors run
   * the same path; their refresh is what swaps their buffer for the row.
   */
  const runEnded = React.useCallback(
    (end: RunEndFrame) => {
      abortRef.current = null
      runIdRef.current = null

      if (end.status === "error" && end.error !== null) toast.error(end.error)
      if (end.usage !== null) setUsage(end.usage)

      if (end.entryId !== null) {
        // The server persisted the TRIMMED text; trimming the buffer to match
        // makes the block on screen byte-identical to the row about to replace
        // it, so the swap is invisible.
        setStreamingText((text) => text.trim())
        setTailEntryId(end.entryId)
      } else {
        // Nothing survived to persist — but the player's turn may already be
        // on disk and unseen.
        setStreamingText("")
      }
      setStatus("settling")

      // The settle refresh is the ORIGIN device's (and it owes one whenever a
      // persisted turn is still invisible — syncRef). A passive mirror rides
      // the bus instead: finishRun touched the story before this frame was
      // sent, so its refresh is already scheduled, and refreshing here too
      // would fan N devices' redundant round-trips out across every run end.
      if (originRef.current || syncRef.current) {
        syncRef.current = false
        startTransition(async () => {
          localRefresh.pending += 1
          try {
            await syncStoryTree()
          } catch {
            // The settle timeout is the backstop; a lost refresh cannot lock
            // the composer for good.
          } finally {
            localRefresh.pending -= 1
          }
        })
      }

      // Exactly the two endings the server reconciles — a stop and a mid-stream
      // failure. A call that finished told us its cost on the way past, and its
      // figures are already in the tree the refresh above delivers.
      if (end.status !== "ok") scheduleCostRefresh()
    },
    [scheduleCostRefresh]
  )

  // Settling ends when everything this turn is waiting on has arrived. Nothing
  // visible changes here: the derivations below already stopped rendering the
  // stand-ins in the commit that delivered the rows.
  const settled =
    (echo?.entryId == null || echoLanded) &&
    (tailEntryId === null || tailLanded)

  React.useEffect(() => {
    if (status !== "settling") return
    if (settled) {
      // The external system here is the router's revalidated tree, observed
      // through props rather than through a subscription callback — this is
      // that callback. The extra render it schedules is one per generation and
      // paints nothing new: every stand-in it retires is already masked by the
      // derivations above, which went false in the commit that brought the
      // rows. Latching on a ref instead would leave dead ids in state that a
      // later delete could resurrect into a permanently busy composer.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      reset()
      return
    }
    const timer = setTimeout(reset, SETTLE_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [reset, settled, status])

  /**
   * Consumes one subscribe stream. Returns "ended" when the terminal frame
   * arrived, "adopted"/"cold" when the stream died without one — the caller
   * re-attaches, and the snapshot frame makes that lossless.
   */
  const consume = React.useCallback(
    async (
      events: AsyncGenerator<RunWireEvent>,
      controller: AbortController
    ): Promise<{ ended: boolean; adopted: boolean }> => {
      // The frame's text seeds the accumulator, so a mid-flight attach and the
      // origin device converge on identical buffers by construction.
      let full = ""
      let adopted = false
      for await (const event of events) {
        if (controller.signal.aborted) return { ended: false, adopted }

        if (event.type === "run") {
          adopted = true
          adoptFrame(event)
          full = event.text
          continue
        }
        if (event.type === "text") {
          full += event.value
          setStreamingText(full)
          setStatus("streaming")
          continue
        }
        if (event.type === "reasoning") {
          // Only ever a promotion out of `pending`. Some models interleave
          // reasoning with prose, and dropping back to `thinking` after the
          // first word would make the indicator flicker between two states
          // mid-passage — once prose is arriving, writing is the honest label.
          setStatus((current) => (current === "pending" ? "thinking" : current))
          continue
        }
        if (event.type === "usage") {
          setUsage(event.usage)
          continue
        }
        if (event.type === "end") {
          runEnded(event)
          return { ended: true, adopted }
        }
        // `ping` (and anything a newer server might add) falls through here.
      }
      return { ended: false, adopted }

      function adoptFrame(frame: RunFrame) {
        // The echo of our own start coming back over run-started, or a
        // re-attach after a blip: same run, and activeRef is already ours.
        activeRef.current = true
        runIdRef.current = frame.runId
        // Stale by definition once adopted: a latched handoff for this same
        // run must not be chased into the linger map after it settles.
        if (pendingAttachRef.current === frame.runId) {
          pendingAttachRef.current = null
        }
        setStreamingText(frame.text)
        setRemovingEntryIds(frame.removingEntryIds)
        // Status is read off the snapshot, not assumed: a device can attach at
        // any point in the run's life and must land in the honest phase.
        setStatus(
          frame.text !== ""
            ? "streaming"
            : frame.reasoningChars > 0
              ? "thinking"
              : "pending"
        )
      }
    },
    [runEnded]
  )

  /**
   * Attach loop: subscribe, mirror, and re-attach on failure until the run
   * ends. `runId` narrows the first subscribe to a specific run (origin start,
   * run-started event); null is the mount probe — "is anything running?".
   *
   * A 204 before anything was adopted is the ordinary idle answer. A 204 (or a
   * silent stream-end) AFTER adopting means the run finished while this device
   * wasn't listening: the persist already happened server-side, so the honest
   * move is to settle and refresh — the row is in the tree, not on this wire.
   */
  const runReader = React.useCallback(
    async (runId: string | null, controller: AbortController) => {
      const sleepers = sleepersRef.current
      let adopted = false
      let attempt = 0
      while (!controller.signal.aborted) {
        let events: AsyncGenerator<RunWireEvent> | null
        try {
          events = await subscribeRun(
            storyId,
            runIdRef.current ?? runId,
            controller.signal
          )
        } catch {
          if (controller.signal.aborted) return
          // Told once per outage, and only by a device that is actually
          // showing a run — a cold probe that cannot reach the server has
          // nothing on screen to explain. Deliberately NOT an ending: the run
          // is still going, and saying otherwise is the bug this replaced.
          if (
            attempt + 1 === SUBSCRIBE_FAILURE_NOTICE &&
            (adopted || runIdRef.current !== null)
          ) {
            toast.error("Lost the connection to the generation — retrying.")
          }
          await delay(backoffFor(attempt), controller.signal, sleepers)
          attempt += 1
          continue
        }

        if (events === null) {
          if (controller.signal.aborted) return
          // runIdRef counts as proof of adoption too: consume() can THROW
          // after adopting (the stall guard fires mid-stream on a woken tab)
          // and its return value — the only place `adopted` is set — is lost.
          // Missing that here would leave activeRef true against a 204 forever:
          // a frozen "streaming" composer nothing can ever reset.
          if (adopted || runIdRef.current !== null) {
            // Missed the ending entirely. entryId is unknown, so the settle
            // derivation can't hold the buffer against its row — the refresh
            // delivers the row and reset clears the stand-in. "aborted", not
            // "ok": the real status is unknown, and aborted is the honest
            // shape — no toast, but the cost refresh a cut-short run needs
            // (a Stop from another device is exactly how a device ends up
            // here) still gets scheduled.
            runEnded({
              type: "end",
              status: "aborted",
              entryId: null,
              error: null,
              usage: null,
            })
          } else if (abortRef.current === controller) {
            // Probe answered "idle": release the slot without touching state.
            abortRef.current = null
            // A run-started can land while the probe is in flight and get
            // refused; with the slot free again, chase it now.
            const pending = pendingAttachRef.current
            pendingAttachRef.current = null
            if (pending !== null) attachFnRef.current?.(pending)
          }
          return
        }

        attempt = 0
        try {
          const result = await consume(events, controller)
          if (result.ended || controller.signal.aborted) return
          adopted ||= result.adopted
        } catch {
          if (controller.signal.aborted) return
        }
        // Stream died mid-run (blip, HMR, backgrounded tab): re-attach. The
        // next snapshot frame replays nothing and loses nothing.
        await delay(backoffFor(attempt), controller.signal, sleepers)
        attempt += 1
      }
    },
    [consume, runEnded, storyId]
  )

  /**
   * Attach without owning: the mount probe (runId null) and the run-started
   * handoff. Deliberately does NOT set activeRef up front — a probe that finds
   * nothing must not have blocked the writer's Continue for a round-trip — so
   * adoption happens when the first frame proves a run exists.
   */
  const attach = React.useCallback(
    (runId: string | null) => {
      // Already attached (possibly to this very run — our own start echoing
      // back over the sync channel) or mid-start: refuse, but keep a FOREIGN
      // runId for later. During the settle window activeRef is still true, and
      // a run started elsewhere in that window (Retry the instant a run ends)
      // gets exactly one run-started — dropping it here would leave this
      // device blind to the whole run. reset() drains the latch.
      if (activeRef.current || abortRef.current !== null) {
        if (runId !== null && runId !== runIdRef.current) {
          pendingAttachRef.current = runId
        }
        return
      }
      const controller = new AbortController()
      abortRef.current = controller
      void runReader(runId, controller)
    },
    [runReader]
  )

  // reset() re-probes through this ref (see its declaration for why).
  React.useEffect(() => {
    attachFnRef.current = attach
  }, [attach])

  // The magic moment: a device that merely OPENS the story while a run is live
  // adopts it — caret moving, Stop armed — with no interaction and no UI.
  React.useEffect(() => {
    attach(null)
  }, [attach])

  /**
   * Waking up and coming back online, handled the way the sync channel handles
   * them (see use-story-sync.ts) — and for a reason this hook has of its own.
   *
   * A held subscribe socket is the thing most likely to have died while the
   * device was away, and on iOS it dies without an error or a close: the read
   * simply never resolves again, so the only thing that notices is the stall
   * guard, up to STALL_TIMEOUT_MS later. That is the frozen caret a writer
   * sees when they come back to a phone mid-generation. Waking is a better
   * signal than silence, so take a fresh socket rather than wait for the old
   * one to be declared dead — the snapshot frame means a re-attach replays
   * nothing and loses nothing.
   */
  const wake = React.useCallback(() => {
    // Whatever is asleep in a backoff should ask again now, not in ten
    // seconds. Copied because done() mutates the set as it drains it.
    for (const sleeper of [...sleepersRef.current]) sleeper()

    if (runIdRef.current !== null) {
      // Attached to a live run: swap the socket under it.
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      void runReader(runIdRef.current, controller)
      return
    }
    // activeRef without a runId is a start still in flight or a settle still
    // waiting on its rows. Neither is holding a socket worth replacing, and
    // both resolve on their own.
    if (activeRef.current) return
    attach(null)
  }, [attach, runReader])

  React.useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") wake()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("online", wake)
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("online", wake)
    }
  }, [wake])

  /**
   * The backstop: the server's own list of what is generating, arriving with
   * every RSC payload (see components/live-runs-beacon.tsx).
   *
   * Everything else that attaches this device is a delivery that can be
   * missed — a run-started event, a subscribe response. This is a fact that
   * is simply true on every refresh, so however a device came to be wrong
   * about a run, it is right again on the next one. It is the same list the
   * sidebar draws "writing · 1m 13s" from, which is exactly the state that
   * used to be visible beside an idle workspace.
   *
   * Probes with null rather than the runId it was given: a list rendered a
   * moment before the run ended would otherwise reach it in the linger map
   * and re-live a finish this device has already seen. Null asks the question
   * that is actually being asked — "is this story running NOW?" — and an idle
   * story answers with one cheap 204.
   */
  React.useEffect(() => {
    const reconcile = (runs: ActiveRun[]) => {
      // Only from a standing start. Anything already attached, probing, or
      // mid-settle knows more about this story than a rendered list does.
      if (activeRef.current || abortRef.current !== null) return
      if (!runs.some((run) => run.storyId === storyId)) return
      attach(null)
    }
    reconcile(liveRuns.last)
    return liveRuns.subscribe(reconcile)
  }, [attach, storyId])

  // The sync channel's run-started handoff (see GenerationOptions.attachRef).
  React.useEffect(() => {
    const ref = optionsRef.current.attachRef
    if (!ref) return
    ref.current = attach
    return () => {
      ref.current = null
    }
  }, [attach])

  const start = React.useCallback(
    (options: StartOptions) => {
      if (activeRef.current) return false
      activeRef.current = true
      originRef.current = true

      // A mount probe may still be in flight; this start supersedes it. If a
      // run really is live, startGeneration answers ok:false and fail() cleans
      // up — the server is the arbiter of "busy", not this tab's timing.
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      unownedTextRef.current = options.restoreOnFailure ?? null

      // One id for the whole turn, handed to both halves; the server upserts
      // the `turn` op on it so the move and its passage are a single ⌘Z.
      //
      // randomId, not crypto.randomUUID — this runs in the browser, where
      // randomUUID is undefined outside a secure context. See lib/id.ts.
      const turnId = randomId()
      startTurnIdRef.current = turnId
      stopDuringStartRef.current = false

      setStatus("pending")
      setStreamingText("")
      // Cleared here rather than in reset(): reset() runs when the row lands, and
      // the totals for the passage that just finished are exactly what a caller
      // wants at that moment. They belong to the last COMPLETED generation, and
      // only a new one invalidates them.
      setUsage(null)
      setTailEntryId(null)
      setEcho(options.echo ? { text: options.echo, entryId: null } : null)
      setRemovingEntryIds(options.removing ?? [])

      startTransition(async () => {
        // Bracketed like every other local transition: startGeneration's turn
        // persist touches the bus, and that echo arriving back over the sync
        // channel mid-start must not trigger a full-tree refresh on the one
        // device already echoing the turn locally.
        localRefresh.pending += 1
        try {
          const res = await startGeneration(storyId, {
            kind: options.kind,
            userText: options.userText,
            turnId,
            variantGroupId: options.variantGroupId,
            removingEntryIds: options.removing,
            requestKind: options.requestKind ?? DEFAULT_REQUEST_KIND,
            profileId: options.profileId,
          })

          if (!res.ok) {
            fail(res.error)
            return
          }
          // The server owns the turn AND the run now — there is nothing left to
          // give back, so a later failure must not refill the composer.
          unownedTextRef.current = null

          // Acknowledged: the echo stops looking provisional now, even though
          // it goes on being rendered from here until its row is delivered.
          const { runId, userEntryId } = res.data
          // Known the moment the server says so, not first at the snapshot
          // frame: the run-started echo of THIS run can beat this response
          // over the sync channel, and attach() needs runIdRef to recognize
          // it as ours rather than latching it as a foreign run to chase.
          runIdRef.current = runId
          if (pendingAttachRef.current === runId)
            pendingAttachRef.current = null
          // A Stop pressed during this round-trip may have outraced the
          // reservation server-side and latched nothing. The run has a name
          // now, so stop it by name; if the latch DID catch it, this second
          // stop finds an already-aborted run and changes nothing.
          if (stopDuringStartRef.current) {
            stopDuringStartRef.current = false
            void stopGeneration(storyId, runId).catch(() => {
              // The screen still shows the run streaming, and Stop still works.
            })
          }
          if (userEntryId !== null) {
            syncRef.current = true
            setEcho((current) =>
              current === null ? current : { ...current, entryId: userEntryId }
            )
          }

          // Deliberately not awaited: chunk updates must be urgent, not
          // transition work, and the transition should settle now so the
          // pending state lifts the moment the stream takes over. If this
          // reader dies, the run does not — it re-attaches, or another device
          // watches the same run finish.
          void runReader(runId, controller)
        } catch {
          fail(GENERATION_ERROR)
        } finally {
          localRefresh.pending -= 1
        }
      })

      return true
    },
    [fail, runReader, storyId]
  )

  const send = React.useCallback(
    (text: string, kind: ActionKind) => {
      const trimmed = text.trim()
      if (trimmed === "") return false

      // The echo runs the SAME transform on the SAME trimmed string the server
      // will translate, so the second-person line the writer sees now and the
      // persisted row that replaces it are byte-identical and the swap is
      // invisible. Anything that makes these two diverge — echoing the raw
      // first-person text, trimming differently, translating only on one side —
      // shows up as the passage rewriting itself a beat after it appears.
      const echo = translateAction(kind, trimmed)
      // An input that translates to nothing (empty quotation marks, punctuation
      // alone) is what the server rejects too, so refuse it here and keep the
      // writer's text in the box. It has to say so: the box is not empty, so a
      // silent false makes Send and Enter look broken.
      if (echo === "") {
        toast.error(
          kind === "say"
            ? "Nothing to say yet — those quotes are empty."
            : "Nothing to send yet — write something first."
        )
        return false
      }

      return start({ kind, userText: trimmed, echo, restoreOnFailure: text })
    },
    [start]
  )

  const continueStory = React.useCallback(() => {
    start({ requestKind: "continue" })
  }, [start])

  // Only the LAST passage can be retried, in place: the new take joins the slot
  // the old one occupies. No retry-from-here any more — rewriting the middle
  // would branch the manuscript.
  const retryLast = React.useCallback(
    (profileId?: string) => {
      const last = entries[entries.length - 1]
      if (!last || last.source !== "generated") return
      start({
        requestKind: "retry",
        variantGroupId: last.variantGroupId,
        // The old take goes inactive, dropping out of `story.entries` as a
        // delete did, so `stillRemoving` retires this id on its own.
        removing: [last.id],
        profileId,
      })
    },
    [entries, start]
  )

  // History moves, not entry moves: what they reverse might be an edit or a
  // take switch, so there is nothing sensible to hide locally and the
  // revalidated tree is the only truth. Shares generation's re-entry guard.
  const runHistory = React.useCallback(
    (
      run: (
        storyId: string
      ) => Promise<ActionResult<{ summary: string } | null>>,
      errorMessage: string
    ) => {
      if (activeRef.current) return
      activeRef.current = true

      startTransition(async () => {
        localRefresh.pending += 1
        try {
          const res = await run(storyId)
          if (!res.ok) toast.error(res.error)
        } catch {
          toast.error(errorMessage)
        } finally {
          localRefresh.pending -= 1
        }
        // Through releaseSlot, not a bare flag flip: a run-started that landed
        // during the undo (Retry on another device) is latched and only the
        // release path chases it.
        releaseSlot()
      })
    },
    [releaseSlot, storyId]
  )

  const undo = React.useCallback(() => {
    runHistory(undoStoryOp, UNDO_ERROR)
  }, [runHistory])

  const redo = React.useCallback(() => {
    runHistory(redoStoryOp, REDO_ERROR)
  }, [runHistory])

  // Fire and forget, and deliberately no local detach: the end frame — emitted
  // after the server persists whatever prose survived — is what drives the
  // settle, exactly as a natural finish does. If the stop fails to reach the
  // server the run honestly keeps going, and the screen keeps saying so.
  const stop = React.useCallback(() => {
    if (!activeRef.current) return
    // The runId names the run this device is actually watching, so a Stop
    // from a device that slept through a settle cannot abort the newer run
    // now holding the story. Null while our own start is still in flight —
    // then the start's turnId is the token, and the server aborts or latches
    // only the run/reservation carrying it: a foreign run that turns out to
    // hold the story (this device missed its run-started) stays untouched,
    // and the intent survives even if this tab dies before the round-trip
    // resolves. The flag is the one ordering the server can't cover — a stop
    // POST beating the start's own reservation — and start() re-fires it by
    // name once the runId is known.
    if (runIdRef.current === null) stopDuringStartRef.current = true
    void stopGeneration(
      storyId,
      runIdRef.current,
      startTurnIdRef.current
    ).catch(() => {
      toast.error("Couldn't reach the server to stop.")
    })
  }, [storyId])

  const lastEntry = entries[entries.length - 1]

  return {
    status,
    busy,
    streamingText: tailLanded ? "" : streamingText,
    usage,
    optimisticUserText: echo !== null && !echoLanded ? echo.text : null,
    optimisticUserPending: echo !== null && echo.entryId === null,
    removingEntryIds: stillRemoving,
    // The server's answer, not "are there any entries": an empty manuscript can
    // have a redo tail, and an imported one has no history to reverse.
    canUndo: !busy && story.canUndo,
    canRedo: !busy && story.canRedo,
    canRetry: !busy && lastEntry?.source === "generated",
    undoLabel: story.undoSummary ? `Undo · ${story.undoSummary}` : "Undo",
    redoLabel: story.redoSummary ? `Redo · ${story.redoSummary}` : "Redo",
    send,
    continueStory,
    retryLast,
    undo,
    redo,
    stop,
  }
}

/** 500ms, 1s, 2s, then every 10s for as long as it takes. */
function backoffFor(failures: number): number {
  return REATTACH_BACKOFF_MS[failures] ?? REATTACH_IDLE_BACKOFF_MS
}

/**
 * Abort-aware sleep: resolves early (never rejects) when the signal fires.
 *
 * Also resolves early when woken through `sleepers` — coming back online is
 * the one moment worth cutting a ten-second backoff short for, and a reader
 * that had to be told twice would spend most of an outage's recovery asleep.
 */
function delay(
  ms: number,
  signal: AbortSignal,
  sleepers: Set<() => void>
): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done, { once: true })
    sleepers.add(done)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      sleepers.delete(done)
      resolve()
    }
  })
}
