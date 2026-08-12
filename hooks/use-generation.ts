"use client"

// hooks/use-generation.ts — The single owner of story generation state.
//
// Flow (MILESTONE2 §3.6): a trigger opens a transition that (optionally deletes
// entries for a retry and) calls prepareGeneration on the server; the returned
// context is then streamed through the local provider outside of any transition
// so chunk updates stay urgent; the finished text is persisted and the story
// tree revalidated.
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

import {
  appendGeneratedEntry,
  deleteEntriesFrom,
  undoLastEntry,
} from "@/lib/actions/entries"
import { prepareGeneration, syncStoryTree } from "@/lib/actions/generation"
import {
  getGenerationProvider,
  type ProviderKind,
} from "@/lib/generation/provider"
import type { ComposedContext } from "@/lib/generation/types"
import { translateAction } from "@/lib/story/action-voice"
import type {
  ActionKind,
  ActionResult,
  GenerationSettings,
  Story,
} from "@/lib/types"

/**
 * `settling` is the window between the last token and the persisted row
 * arriving: the prose is finished and final, still rendered from the local
 * buffer, and no longer stoppable.
 */
export type GenerationStatus = "idle" | "pending" | "streaming" | "settling"

const GENERATION_ERROR = "Generation failed. Try again."
const UNDO_ERROR = "Couldn't undo the last passage."

/**
 * How long to wait for a revalidated tree before giving up on it. Only reached
 * if a revalidation is lost or the page never re-renders; without it the writer
 * would be locked out of the composer for good.
 */
const SETTLE_TIMEOUT_MS = 6000

type Prepared = {
  context: ComposedContext
  settings: GenerationSettings
  providerKind: ProviderKind
  userEntryId: string | null
}

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
  /** Runs inside the same transition, just before prepareGeneration. */
  before?: () => Promise<ActionResult<unknown>>
  /** Echoed locally until revalidation delivers the persisted passage. */
  echo?: string
  /** Entry ids hidden locally until the retry deletion is revalidated. */
  removing?: string[]
  /** Retries bump the fixture variant; every other trigger resets it. */
  isRetry?: boolean
  /** Composer text to hand back if the dispatch fails before the server owns it. */
  restoreOnFailure?: string
}

export interface GenerationController {
  status: GenerationStatus
  /** True while any generation or entry mutation is in flight. */
  busy: boolean
  /** In-flight prose, and then the finished passage until its row lands. */
  streamingText: string
  /** User passage echoed locally while the server round-trip runs. */
  optimisticUserText: string | null
  /** True while that echo is still unacknowledged by the server. */
  optimisticUserPending: boolean
  /** Entries removed locally ahead of the server (retry / undo). */
  removingEntryIds: string[]
  canUndo: boolean
  canRetry: boolean
  /** Returns true when the text was accepted (composer clears on true). */
  send: (text: string, kind: ActionKind) => boolean
  continueStory: () => void
  retryLast: () => void
  retryFrom: (entryId: string) => void
  undo: () => void
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
  // True while a persisted player turn is invisible to the client, because
  // prepareGeneration wrote it without revalidating. Cleared by whichever
  // terminal path refreshes the tree.
  const syncRef = React.useRef(false)

  React.useEffect(() => () => abortRef.current?.abort(), [])

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

      startTransition(async () => {
        try {
          const res = await appendGeneratedEntry(storyId, trimmed)
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
      try {
        const provider = getGenerationProvider(prepared.providerKind)
        for await (const chunk of provider.generate({
          context: prepared.context,
          settings: prepared.settings,
          signal: controller.signal,
        })) {
          if (controller.signal.aborted) break
          full += chunk
          setStreamingText(full)
          setStatus("streaming")
        }
      } catch (err) {
        // Surface the provider's specific message (bad key, credits, rate
        // limit) when there is one; aborts stay silent as before.
        if (!controller.signal.aborted)
          toast.error(
            err instanceof Error && err.message ? err.message : GENERATION_ERROR
          )
      }
      finalize(full)
    },
    [finalize]
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

      setStatus("pending")
      setStreamingText("")
      setTailEntryId(null)
      setEcho(options.echo ? { text: options.echo, entryId: null } : null)
      setRemovingEntryIds(options.removing ?? [])

      startTransition(async () => {
        try {
          if (options.before) {
            const pre = await options.before()
            if (!pre.ok) {
              fail(pre.error)
              return
            }
          }

          const prepared = await prepareGeneration(storyId, {
            kind: options.kind,
            userText: options.userText,
            variant,
          })

          if (!prepared.ok) {
            fail(prepared.error)
            return
          }
          // The server has persisted the passage — there is nothing left to
          // give back, so a later failure must not refill the composer.
          unownedTextRef.current = null

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
    start({})
  }, [start])

  const retryFrom = React.useCallback(
    (entryId: string) => {
      const index = entries.findIndex((entry) => entry.id === entryId)
      if (index === -1) return
      start({
        isRetry: true,
        removing: entries.slice(index).map((entry) => entry.id),
        before: () => deleteEntriesFrom(storyId, entryId),
      })
    },
    [entries, start, storyId]
  )

  const retryLast = React.useCallback(() => {
    const last = entries[entries.length - 1]
    if (!last || last.source !== "generated") return
    retryFrom(last.id)
  }, [entries, retryFrom])

  const undo = React.useCallback(() => {
    if (activeRef.current) return
    const last = entries[entries.length - 1]
    if (!last) return

    activeRef.current = true
    variantRef.current = 0
    lastWasRetryRef.current = false
    // Not cleared when the action resolves: `stillRemoving` drops it the moment
    // the revalidated story no longer contains it, so the row can't blink back.
    setRemovingEntryIds([last.id])

    startTransition(async () => {
      try {
        const res = await undoLastEntry(storyId)
        if (!res.ok) toast.error(res.error)
      } catch {
        toast.error(UNDO_ERROR)
      }
      activeRef.current = false
    })
  }, [entries, storyId])

  const stop = React.useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const lastEntry = entries[entries.length - 1]

  return {
    status,
    busy,
    streamingText: tailLanded ? "" : streamingText,
    optimisticUserText: echo !== null && !echoLanded ? echo.text : null,
    optimisticUserPending: echo !== null && echo.entryId === null,
    removingEntryIds: stillRemoving,
    canUndo: !busy && entries.length > 0,
    canRetry: !busy && lastEntry?.source === "generated",
    send,
    continueStory,
    retryLast,
    retryFrom,
    undo,
    stop,
  }
}
