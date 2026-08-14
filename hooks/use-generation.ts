"use client"

// hooks/use-generation.ts — The single owner of story generation state.
//
// Flow (MILESTONE2 §3.6): a trigger opens a transition that calls
// prepareGeneration on the server; the returned context is then streamed
// through the local provider outside of any transition so chunk updates stay
// urgent; the finished text is persisted and the story tree revalidated.
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
// prepareGeneration no longer revalidates (see its comment), so `syncRef` tracks
// the window where a persisted player turn exists that the client hasn't been
// handed yet, and every terminal path refreshes the tree if it is still open.

import * as React from "react"
import { toast } from "sonner"

import { appendGeneratedEntry } from "@/lib/actions/entries"
import { prepareGeneration, syncStoryTree } from "@/lib/actions/generation"
import { redoStoryOp, undoStoryOp } from "@/lib/actions/history"
import {
  getGenerationProvider,
  type ProviderKind,
} from "@/lib/generation/provider"
import type { ComposedContext, GenerationUsage } from "@/lib/generation/types"
import { randomId } from "@/lib/id"
import { translateAction } from "@/lib/story/action-voice"
import type {
  ActionKind,
  ActionResult,
  EntryGeneration,
  GenerationRequestKind,
  GenerationSettings,
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

type Prepared = {
  context: ComposedContext
  settings: GenerationSettings
  providerKind: ProviderKind
  userEntryId: string | null
}

/** What the server calls a generation that arrived with no move attached. */
const DEFAULT_REQUEST_KIND: GenerationRequestKind = "generate"

/** The player's turn, shown from here until its own row lands. */
type Echo = {
  text: string
  /** Null until prepareGeneration comes back — i.e. while unacknowledged. */
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
   * deactivates the slot's current take in the same transaction.
   */
  variantGroupId?: string
  /** Entry ids hidden locally until the deactivated take stops being delivered. */
  removing?: string[]
  /** Retries bump the fixture variant; every other trigger resets it. */
  isRetry?: boolean
  /** Which move this is, recorded on the spend ledger row. */
  requestKind?: GenerationRequestKind
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
   * finished. Only ever set from the provider's final `usage` event — never
   * estimated — so a caller can render it as an authoritative figure. The same
   * counts are persisted onto the row, which is what the variant switcher's
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
  retryLast: () => void
  undo: () => void
  redo: () => void
  stop: () => void
}

export interface GenerationOptions {
  /**
   * Called with text that the composer cleared optimistically but that the
   * server never took ownership of. Both Say and Do clear the composer the
   * instant they dispatch, so if the append or prepare step fails there is no
   * other copy of the writer's words anywhere — the row was never inserted and
   * the textarea is already empty. This hands them back verbatim (untrimmed, as
   * typed) instead of destroying them.
   */
  onRestoreDraft?: (text: string) => void
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
  const activeRef = React.useRef(false)
  const abortRef = React.useRef<AbortController | null>(null)
  const variantRef = React.useRef(0)
  const lastWasRetryRef = React.useRef(false)
  // Text the composer cleared on dispatch that only this hook can give back.
  const unownedTextRef = React.useRef<string | null>(null)
  // Refs, not state: finalize() runs from the streaming callback and would
  // close over whatever was current when that closure was created — before the
  // request was even prepared. The usage event always arrives afterwards, so
  // reading it from state there would persist null every time.
  const turnIdRef = React.useRef<string | null>(null)
  const variantGroupRef = React.useRef<string | null>(null)
  const settingsRef = React.useRef<GenerationSettings | null>(null)
  const usageRef = React.useRef<GenerationUsage | null>(null)
  // The spend-ledger row the route opened for this generation, from its `meta`
  // event. Same reason as usageRef: finalize() closes over state from before the
  // request existed, and meta arrives long afterwards. Null on the offline mock,
  // and null for anything the route failed to record — the link is an extra, and
  // a passage must never fail to save because the bookkeeping did.
  const callIdRef = React.useRef<string | null>(null)
  const requestKindRef =
    React.useRef<GenerationRequestKind>(DEFAULT_REQUEST_KIND)
  // True while a persisted player turn is invisible to the client, because
  // prepareGeneration wrote it without revalidating. Cleared by whichever
  // terminal path refreshes the tree.
  const syncRef = React.useRef(false)
  // The pending post-reconciliation refresh, if any. See RECONCILE_SETTLE_MS.
  const costRefreshRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  )

  React.useEffect(
    () => () => {
      abortRef.current?.abort()
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

  const reset = React.useCallback(() => {
    activeRef.current = false
    abortRef.current = null
    setStatus("idle")
    setStreamingText("")
    setEcho(null)
    setTailEntryId(null)
    setRemovingEntryIds([])
  }, [])

  /** Refreshes the tree if a player turn is still only on disk. */
  const syncIfOwed = React.useCallback(() => {
    if (!syncRef.current) return
    syncRef.current = false
    startTransition(async () => {
      try {
        await syncStoryTree()
      } catch {
        // The echo is already gone or about to be; a failed refresh is not
        // worth a toast on top of whatever else went wrong.
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

  const finalize = React.useCallback(
    (text: string) => {
      const trimmed = text.trim()
      abortRef.current = null

      // Aborted before a single word arrived: persist nothing, but the player's
      // turn may already be on disk and unseen.
      if (trimmed === "") {
        setStreamingText("")
        setStatus("settling")
        syncIfOwed()
        return
      }

      // The buffer is squared with what is about to be persisted and then left
      // alone — the block on screen IS the final passage, and it stays put until
      // its row can replace it invisibly.
      setStreamingText(trimmed)
      setStatus("settling")

      // The settings the server actually composed with, not whatever the
      // inspector shows by the time this lands: the writer can change the model
      // mid-stream, and the passage would then name one that never saw it.
      const settings = settingsRef.current
      const usage = usageRef.current
      const generation: EntryGeneration | null = settings
        ? {
            modelId: settings.modelId,
            thinking: settings.thinking,
            temperature: settings.temperature,
            promptTokens: usage?.promptTokens ?? null,
            completionTokens: usage?.completionTokens ?? null,
          }
        : null

      startTransition(async () => {
        try {
          const res = await appendGeneratedEntry(storyId, trimmed, {
            turnId: turnIdRef.current,
            // Undefined, not null: with no slot this is an ordinary append at
            // the end, and with one it is a new take inside that slot.
            variantGroupId: variantGroupRef.current ?? undefined,
            generation,
            // Links the money to the passage. The insert stamps it on the
            // ledger row inside its own transaction; a stale or absent one just
            // leaves the row unlinked, which is what an aborted call looks like.
            callId: callIdRef.current,
          })
          if (!res.ok) {
            toast.error(res.error)
            reset()
            return
          }
          // That insert revalidated, so the player's turn is covered too.
          syncRef.current = false
          setTailEntryId(res.data.entry.id)
        } catch {
          toast.error(GENERATION_ERROR)
          reset()
        }
      })
    },
    [reset, storyId, syncIfOwed]
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

  const stream = React.useCallback(
    async (prepared: Prepared, controller: AbortController) => {
      let full = ""
      let failed = false
      try {
        const provider = getGenerationProvider(prepared.providerKind)
        for await (const event of provider.generate({
          context: prepared.context,
          settings: prepared.settings,
          signal: controller.signal,
          storyId,
          requestKind: requestKindRef.current,
        })) {
          if (controller.signal.aborted) break

          if (event.type === "meta") {
            // Ref only, and never rendered: this is bookkeeping identity, not
            // anything the writer has a reason to see.
            callIdRef.current = event.callId
            continue
          }

          if (event.type === "reasoning") {
            // Only ever a promotion out of `pending`. Some models interleave
            // reasoning with prose, and dropping back to `thinking` after the
            // first word would make the indicator flicker between two states
            // mid-passage — once prose is arriving, writing is the honest label.
            setStatus((current) =>
              current === "pending" ? "thinking" : current
            )
            continue
          }

          if (event.type === "usage") {
            // Ref and state both: the ref is what finalize() persists (see its
            // comment), the state is what renders.
            usageRef.current = event.usage
            setUsage(event.usage)
            continue
          }

          full += event.value
          setStreamingText(full)
          setStatus("streaming")
        }
      } catch (err) {
        failed = true
        // Surface the provider's specific message (bad key, credits, rate
        // limit) when there is one; aborts stay silent as before.
        if (!controller.signal.aborted)
          toast.error(
            err instanceof Error && err.message ? err.message : GENERATION_ERROR
          )
      }
      finalize(full)
      // Exactly the two endings the server reconciles — a stop and a mid-stream
      // failure. A call that finished told us its cost on the way past, and its
      // figures are already in the tree the persisted passage revalidated.
      if (failed || controller.signal.aborted) scheduleCostRefresh()
    },
    [finalize, scheduleCostRefresh, storyId]
  )

  const start = React.useCallback(
    (options: StartOptions) => {
      if (activeRef.current) return false
      activeRef.current = true

      if (options.isRetry) {
        variantRef.current = lastWasRetryRef.current
          ? variantRef.current + 1
          : 1
      } else {
        variantRef.current = 0
      }
      lastWasRetryRef.current = Boolean(options.isRetry)
      const variant = variantRef.current

      const controller = new AbortController()
      abortRef.current = controller
      unownedTextRef.current = options.restoreOnFailure ?? null

      // One id for the whole turn, handed to both halves; the server upserts
      // the `turn` op on it so the move and its passage are a single ⌘Z.
      //
      // randomId, not crypto.randomUUID — this runs in the browser, where
      // randomUUID is undefined outside a secure context. See lib/id.ts.
      const turnId = randomId()
      turnIdRef.current = turnId
      variantGroupRef.current = options.variantGroupId ?? null
      settingsRef.current = null
      usageRef.current = null
      callIdRef.current = null
      requestKindRef.current = options.requestKind ?? DEFAULT_REQUEST_KIND

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
        try {
          const prepared = await prepareGeneration(storyId, {
            kind: options.kind,
            userText: options.userText,
            variant,
            turnId,
            // Needed on the way OUT as well as back: the context is composed
            // without this slot, so the model writes an alternative rather than
            // a continuation. The old take is still active here — it is only
            // deactivated when the new one is inserted.
            variantGroupId: options.variantGroupId,
          })

          if (!prepared.ok) {
            fail(prepared.error)
            return
          }
          // The server has persisted the passage — there is nothing left to
          // give back, so a later failure must not refill the composer.
          unownedTextRef.current = null
          settingsRef.current = prepared.data.settings

          // Acknowledged: the echo stops looking provisional now, even though
          // it goes on being rendered from here until its row is delivered.
          const { userEntryId } = prepared.data
          if (userEntryId !== null) {
            syncRef.current = true
            setEcho((current) =>
              current === null ? current : { ...current, entryId: userEntryId }
            )
          }

          if (controller.signal.aborted) {
            finalize("")
            return
          }

          // Deliberately not awaited: chunk updates must be urgent, not
          // transition work, and the transition should settle now so the
          // pending state lifts the moment the provider takes over.
          void stream(prepared.data, controller)
        } catch {
          fail(GENERATION_ERROR)
        }
      })

      return true
    },
    [fail, finalize, storyId, stream]
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
  const retryLast = React.useCallback(() => {
    const last = entries[entries.length - 1]
    if (!last || last.source !== "generated") return
    start({
      isRetry: true,
      requestKind: "retry",
      variantGroupId: last.variantGroupId,
      // The old take goes inactive, dropping out of `story.entries` as a
      // delete did, so `stillRemoving` retires this id on its own.
      removing: [last.id],
    })
  }, [entries, start])

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
      variantRef.current = 0
      lastWasRetryRef.current = false

      startTransition(async () => {
        try {
          const res = await run(storyId)
          if (!res.ok) toast.error(res.error)
        } catch {
          toast.error(errorMessage)
        }
        activeRef.current = false
      })
    },
    [storyId]
  )

  const undo = React.useCallback(() => {
    runHistory(undoStoryOp, UNDO_ERROR)
  }, [runHistory])

  const redo = React.useCallback(() => {
    runHistory(redoStoryOp, REDO_ERROR)
  }, [runHistory])

  const stop = React.useCallback(() => {
    abortRef.current?.abort()
  }, [])

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
