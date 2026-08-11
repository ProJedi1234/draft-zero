"use client"

// hooks/use-generation.ts — The single owner of story generation state.
//
// Flow (MILESTONE2 §3.6): a trigger opens a transition that (optionally deletes
// entries for a retry and) calls prepareGeneration on the server; the returned
// context is then streamed through the local provider outside of any transition
// so chunk updates stay urgent; the finished text is persisted in a second
// transition that clears the local buffer in the SAME commit as the revalidated
// entry — so the streamed block is replaced without a flash.

import * as React from "react"
import { toast } from "sonner"

import {
  appendGeneratedEntry,
  deleteEntriesFrom,
  undoLastEntry,
} from "@/lib/actions/entries"
import { prepareGeneration } from "@/lib/actions/generation"
import {
  getGenerationProvider,
  type ProviderKind,
} from "@/lib/generation/provider"
import type { ComposedContext } from "@/lib/generation/types"
import type { ActionResult, GenerationSettings, Story } from "@/lib/types"

export type GenerationStatus = "idle" | "pending" | "streaming"
export type ComposerMode = "story" | "instruction"

const GENERATION_ERROR = "Generation failed. Try again."
const UNDO_ERROR = "Couldn't undo the last passage."

type Prepared = {
  context: ComposedContext
  settings: GenerationSettings
  providerKind: ProviderKind
}

interface StartOptions {
  mode: ComposerMode
  /** Persisted as a user passage (story mode) or sent as an instruction. */
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
  streamingText: string
  /** User passage echoed locally while the server round-trip runs. */
  optimisticUserText: string | null
  /** Entries removed locally ahead of the server (retry / undo). */
  removingEntryIds: string[]
  canUndo: boolean
  canRetry: boolean
  /** Returns true when the text was accepted (composer clears on true). */
  send: (text: string, mode: ComposerMode) => boolean
  continueStory: () => void
  retryLast: () => void
  retryFrom: (entryId: string) => void
  undo: () => void
  stop: () => void
}

export interface GenerationOptions {
  /**
   * Called with text that the composer cleared optimistically but that the
   * server never took ownership of — instruction-mode input, which is
   * deliberately never persisted (§3.6). Story-mode text is not restored: the
   * server already holds it as a user passage.
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
  const [optimisticUserText, setOptimisticUserText] = React.useState<
    string | null
  >(null)
  const [removingEntryIds, setRemovingEntryIds] = React.useState<string[]>([])
  const [isPending, startTransition] = React.useTransition()

  // Synchronous re-entry guard: state lands a tick too late for fast clicks.
  const activeRef = React.useRef(false)
  const abortRef = React.useRef<AbortController | null>(null)
  const variantRef = React.useRef(0)
  const lastWasRetryRef = React.useRef(false)
  // Text the composer cleared on dispatch that only this hook can give back.
  const unownedTextRef = React.useRef<string | null>(null)

  React.useEffect(() => () => abortRef.current?.abort(), [])

  const busy = isPending || status !== "idle"

  const reset = React.useCallback(() => {
    activeRef.current = false
    abortRef.current = null
    setStatus("idle")
    setStreamingText("")
    setOptimisticUserText(null)
    setRemovingEntryIds([])
  }, [])

  const fail = React.useCallback(
    (message: string) => {
      toast.error(message)
      // The round-trip never got as far as owning this text, so hand it back to
      // the composer rather than losing what the writer typed.
      const unowned = unownedTextRef.current
      unownedTextRef.current = null
      if (unowned !== null) optionsRef.current.onRestoreDraft?.(unowned)
      reset()
    },
    [reset]
  )

  const finalize = React.useCallback(
    (text: string) => {
      const trimmed = text.trim()
      abortRef.current = null

      // Aborted before a single word arrived: persist nothing.
      if (trimmed === "") {
        reset()
        return
      }

      startTransition(async () => {
        try {
          const res = await appendGeneratedEntry(storyId, trimmed)
          if (!res.ok) toast.error(res.error)
        } catch {
          toast.error(GENERATION_ERROR)
        }
        // Cleared inside the transition: the persisted entry and the emptied
        // buffer commit together, so the prose never blinks.
        reset()
      })
    },
    [reset, storyId]
  )

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
            err instanceof Error && err.message
              ? err.message
              : GENERATION_ERROR
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
      setOptimisticUserText(options.echo ?? null)
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
            mode: options.mode,
            userText: options.userText,
            variant,
          })

          // Revalidation has delivered the real rows by the time this
          // transition commits, so the local stand-ins go away in the same
          // commit — never a duplicate, never a gap.
          setOptimisticUserText(null)
          setRemovingEntryIds([])

          if (!prepared.ok) {
            fail(prepared.error)
            return
          }
          // The server has taken the text (persisted passage or consumed
          // instruction) — there is nothing left to give back.
          unownedTextRef.current = null
          if (controller.signal.aborted) {
            reset()
            return
          }

          // Deliberately not awaited: chunk updates must be urgent, not
          // transition work, and the transition should settle now so the
          // persisted user passage paints immediately.
          void stream(prepared.data, controller)
        } catch {
          fail(GENERATION_ERROR)
        }
      })

      return true
    },
    [fail, reset, storyId, stream]
  )

  const send = React.useCallback(
    (text: string, mode: ComposerMode) => {
      const trimmed = text.trim()
      if (trimmed === "") return false
      return start(
        mode === "instruction"
          ? { mode, userText: trimmed, restoreOnFailure: text }
          : { mode: "story", userText: trimmed, echo: trimmed }
      )
    },
    [start]
  )

  const continueStory = React.useCallback(() => {
    start({ mode: "story" })
  }, [start])

  const retryFrom = React.useCallback(
    (entryId: string) => {
      const index = entries.findIndex((entry) => entry.id === entryId)
      if (index === -1) return
      start({
        mode: "story",
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
    setRemovingEntryIds([last.id])

    startTransition(async () => {
      try {
        const res = await undoLastEntry(storyId)
        if (!res.ok) toast.error(res.error)
      } catch {
        toast.error(UNDO_ERROR)
      }
      activeRef.current = false
      setRemovingEntryIds([])
    })
  }, [entries, storyId])

  const stop = React.useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const lastEntry = entries[entries.length - 1]

  return {
    status,
    busy,
    streamingText,
    optimisticUserText,
    removingEntryIds,
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
