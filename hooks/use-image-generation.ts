"use client"

import * as React from "react"
import { toast } from "sonner"

import type { ImageAspectRatio } from "@/lib/types"

/** What the composer hands over when the writer sends an image. */
export interface IllustrateRequest {
  prompt: string
  aspectRatio: ImageAspectRatio
  /** Set only by a retry — names the slot the new draw joins. */
  imageGroupId?: string
}

export interface ImageJob {
  aspectRatio: ImageAspectRatio
  /** The latest partial, or null before the first one lands. */
  previewB64: string | null
  mediaType: string
}

/**
 * Runs one illustration to completion.
 *
 * Scoped to the STORY rather than to a passage: an image is a beat the writer
 * asks for from the composer, so there is one in flight at a time for the
 * manuscript, the same way there is one generation at a time.
 *
 * The work happens SERVER-side (POST /api/image) — this only holds the
 * in-flight state and the abort. It has to: the key lives on the server, the
 * ledger row has to be opened before the first byte, and a stop has to reach
 * the upstream request rather than merely stopping the browser listening.
 */
export function useImageGeneration(
  storyId: string,
  options: {
    /**
     * Hands the prompt back when a generation produced nothing.
     *
     * The composer clears the instant Send dispatches, so from that moment the
     * only copy of what the writer typed is in flight. A failure that dropped
     * it would make every retry a retype — and the prompt is the expensive part
     * of an illustration, sometimes literally, since the wand may have been
     * paid for to write it.
     */
    onRestoreDraft?: (prompt: string) => void
  } = {}
) {
  const [job, setJob] = React.useState<ImageJob | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)

  // A generation outlives the composer that started it but not the story:
  // switching stories must not leave a request writing into a canvas that has
  // moved on. Aborting the fetch aborts the upstream call too — see the route.
  React.useEffect(() => {
    return () => abortRef.current?.abort()
  }, [storyId])

  // Read through a ref so `generate` does not have to be rebuilt (and every
  // in-flight closure invalidated) each time the workspace re-renders with a
  // new callback identity.
  const optionsRef = React.useRef(options)
  // In an effect, not during render — the same shape useGeneration uses. A ref
  // written during render is a value React is entitled to discard.
  React.useEffect(() => {
    optionsRef.current = options
  })

  // Held so a failure can hand the words back. Cleared once a generation
  // settles into a row, at which point the prompt is on disk and the composer
  // is not where it belongs any more.
  const promptRef = React.useRef<string | null>(null)

  const restoreDraft = React.useCallback(() => {
    const prompt = promptRef.current
    promptRef.current = null
    if (prompt !== null) optionsRef.current.onRestoreDraft?.(prompt)
  }, [])

  const stop = React.useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setJob(null)
    // A stop is a decision to change something, which almost always means the
    // prompt. Handing it back is the difference between "stop and edit" and
    // "stop and retype".
    restoreDraft()
  }, [restoreDraft])

  const generate = React.useCallback(
    async (request: IllustrateRequest) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      promptRef.current = request.prompt

      // previewB64 stays null for the whole run: the response is one JSON
      // object, so the figure shimmers at the right aspect ratio until the
      // picture lands. Partial previews are a GPT-Image-only feature and are
      // not wired yet — see lib/images/openrouter.ts.
      setJob({
        aspectRatio: request.aspectRatio,
        previewB64: null,
        mediaType: "",
      })

      try {
        const res = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storyId,
            prompt: request.prompt,
            aspectRatio: request.aspectRatio,
            imageGroupId: request.imageGroupId,
          }),
          signal: controller.signal,
        })

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string
          } | null
          // 499 is this route's "the writer stopped it" — their own action, so
          // it gets no error toast.
          if (res.status !== 499) {
            toast.error(body?.error ?? "Couldn't generate that illustration.")
          }
          setJob(null)
          restoreDraft()
          return
        }
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          toast.error("Couldn't generate that illustration.")
        }
        setJob(null)
        restoreDraft()
        return
      } finally {
        if (abortRef.current === controller) abortRef.current = null
      }

      // Succeeded: the prompt is on the row now, so there is nothing left to
      // hand back and a later stop must not resurrect it into the composer.
      promptRef.current = null

      // The job is held past the response so the shimmer covers the gap until
      // the revalidated tree delivers the row — otherwise the figure vanishes
      // and reappears. `settle` hands over.
    },
    [restoreDraft, storyId]
  )

  const settle = React.useCallback(() => setJob(null), [])

  return { job, generate, stop, settle }
}

/**
 * Derives an image prompt for where the story currently is.
 *
 * Explicitly invoked — there is no auto-derive on entering image mode. This is
 * a real model call with a real price, and a mode toggle that silently bills
 * the writer is the kind of surprise a spend ledger exists to prevent. The wand
 * is one tap, and one tap is cheap enough.
 */
export function useImagePromptDerivation(storyId: string) {
  const [deriving, setDeriving] = React.useState(false)
  const abortRef = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    return () => abortRef.current?.abort()
  }, [storyId])

  const cancel = React.useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setDeriving(false)
  }, [])

  /**
   * Streams the prompt through `onText`, which receives the text SO FAR rather
   * than a delta — the composer's draft is controlled state, and handing it
   * fragments would make every caller reimplement the same accumulation.
   */
  const derive = React.useCallback(
    async (onText: (textSoFar: string) => void) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setDeriving(true)
      onText("")

      try {
        const res = await fetch("/api/image-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storyId }),
          signal: controller.signal,
        })

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string
          } | null
          toast.error(body?.error ?? "Couldn't write a prompt for this scene.")
          return
        }
        if (!res.body) return

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let text = ""
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (controller.signal.aborted) return
          text += decoder.decode(value, { stream: true })
          onText(text)
        }
      } catch (err) {
        // An abort is the writer changing their mind, not a failure.
        if ((err as Error)?.name !== "AbortError") {
          toast.error("Couldn't write a prompt for this scene.")
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        setDeriving(false)
      }
    },
    [storyId]
  )

  return { deriving, derive, cancel }
}
