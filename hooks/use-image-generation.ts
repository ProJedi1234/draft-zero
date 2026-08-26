"use client"

import * as React from "react"
import { toast } from "sonner"

import { stopIllustration } from "@/lib/actions/images"
import { subscribeImageRun } from "@/lib/sync/client"
import type { ImageAspectRatio } from "@/lib/types"

/** What the composer hands over when the writer sends an image. */
export interface IllustrateRequest {
  prompt: string
  aspectRatio: ImageAspectRatio
  /** Set only by a retry — names the slot the new draw joins. */
  imageGroupId?: string
}

export interface ImageJob {
  runId: string
  aspectRatio: ImageAspectRatio
  /** The latest partial, or null before the first one lands. */
  previewB64: string | null
  mediaType: string
  /**
   * Set by the end frame once the row is committed. The job is then held until
   * the refreshed story tree carries that id, so the finished picture never
   * blinks out and back — the workspace's settle effect is the handover.
   */
  landedImageId: string | null
}

/** How long to wait before re-attaching after a dropped subscribe stream. */
const RETRY_BACKOFF_MS = [1000, 2000, 5000]

/**
 * Mirrors a story's live image run — whoever started it.
 *
 * The picture twin of useGeneration's attach model: the draw itself is a
 * detached task on the server (lib/images/live.ts), and this hook is a pure
 * subscriber. `generate` launches a run and watches it; `attach` watches one
 * some other device launched (handed over via image-run-started on the sync
 * channel) or probes "is anything drawing?" with a null runId on mount and
 * reconnect. Detaching — switching stories, closing the tab — leaves the draw
 * running, which is the entire point; only `stop` aborts it, from any device.
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
     * paid for to write it. Only the device that sent the prompt restores it:
     * an attached device never held the draft, so it has nothing to put back.
     */
    onRestoreDraft?: (prompt: string) => void
  } = {}
) {
  const [job, setJob] = React.useState<ImageJob | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)

  // Read through refs so the callbacks below keep one identity across
  // renders — same shape as useGeneration. Written in an effect, not during
  // render: a ref written during render is a value React may discard.
  const jobRef = React.useRef<ImageJob | null>(null)
  const optionsRef = React.useRef(options)
  React.useEffect(() => {
    jobRef.current = job
    optionsRef.current = options
  })

  // Held so a failure can hand the words back; null on attached devices.
  const promptRef = React.useRef<string | null>(null)

  const restoreDraft = React.useCallback(() => {
    const prompt = promptRef.current
    promptRef.current = null
    if (prompt !== null) optionsRef.current.onRestoreDraft?.(prompt)
  }, [])

  /**
   * The one watch loop. Subscribes (a null runId is the probe), folds frames
   * into `job`, and re-attaches on a dropped stream — a stall mid-draw must
   * not strand the shimmer, and the linger window means even a run that
   * finished during the gap still delivers its end frame.
   */
  const watch = React.useCallback(
    async (runId: string | null) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      let currentRunId = runId
      for (let attempt = 0; !controller.signal.aborted; attempt++) {
        let events: AsyncGenerator<
          import("@/lib/sync/types").ImageRunWireEvent
        > | null
        try {
          events = await subscribeImageRun(
            storyId,
            currentRunId,
            controller.signal
          )
        } catch {
          if (controller.signal.aborted) return
          const backoff =
            RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]
          await new Promise((resolve) => setTimeout(resolve, backoff))
          continue
        }

        // 204: nothing running (and nothing lingering under that id). For the
        // probe that answer IS the state; for a named run it means the linger
        // window closed — either way the honest job is none.
        if (events === null) {
          if (!controller.signal.aborted) setJob(null)
          return
        }

        try {
          for await (const event of events) {
            if (controller.signal.aborted) return
            if (event.type === "image-run") {
              currentRunId = event.runId
              setJob({
                runId: event.runId,
                aspectRatio: event.aspectRatio,
                previewB64: event.previewB64,
                mediaType: event.previewMediaType ?? "",
                landedImageId: null,
              })
            } else if (event.type === "partial") {
              setJob((prev) =>
                prev
                  ? { ...prev, previewB64: event.b64, mediaType: event.mediaType }
                  : prev
              )
            } else if (event.type === "end") {
              if (event.status === "ok" && event.imageId !== null) {
                // Held, not cleared: the shimmer covers the gap until the
                // revalidated tree delivers the row. The prompt is on disk
                // now, so a later stop must not resurrect it.
                promptRef.current = null
                setJob((prev) =>
                  prev ? { ...prev, landedImageId: event.imageId } : prev
                )
              } else {
                if (event.status === "error") {
                  toast.error(
                    event.error ?? "Couldn't generate that illustration."
                  )
                }
                // Aborted is the writer's own decision — no toast, and the
                // origin device gets its words back to edit.
                setJob(null)
                restoreDraft()
              }
              return
            }
            // Pings need no handling — arriving is their whole content.
          }
          // The stream ended without an end frame: a dropped socket. Loop and
          // re-attach to the same run.
        } catch {
          if (controller.signal.aborted) return
        }
      }
    },
    [storyId, restoreDraft]
  )

  // A watcher outlives the composer but not the story: switching stories
  // detaches the listener and nothing else — the draw keeps going without us.
  React.useEffect(() => {
    return () => abortRef.current?.abort()
  }, [storyId])

  const stop = React.useCallback(() => {
    // The server owns the run, so Stop is an action any device may call. The
    // job is NOT cleared here: the loop settles, the end frame arrives with
    // status aborted, and the same path every device takes clears it — with
    // the draft handed back on the device that typed it.
    const current = jobRef.current
    void stopIllustration(storyId, current?.runId ?? null)
  }, [storyId])

  const generate = React.useCallback(
    async (request: IllustrateRequest) => {
      promptRef.current = request.prompt

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
        })
        const body = (await res.json().catch(() => null)) as {
          runId?: string
          error?: string
        } | null
        if (!res.ok || !body?.runId) {
          toast.error(body?.error ?? "Couldn't generate that illustration.")
          restoreDraft()
          return
        }
        // Shown before the first frame arrives, so the placeholder reserves
        // its box the instant Send lands rather than a round-trip later.
        setJob({
          runId: body.runId,
          aspectRatio: request.aspectRatio,
          previewB64: null,
          mediaType: "",
          landedImageId: null,
        })
        void watch(body.runId)
      } catch {
        toast.error("Couldn't generate that illustration.")
        restoreDraft()
      }
    },
    [restoreDraft, storyId, watch]
  )

  /** Attach to a run someone else started (image-run-started), or re-probe (null). */
  const attach = React.useCallback(
    (runId: string | null) => {
      // Already watching that very run — a reattach would drop the socket to
      // open an identical one.
      if (runId !== null && jobRef.current?.runId === runId) return
      void watch(runId)
    },
    [watch]
  )

  // The magic moment, same as the text side's: a device that merely OPENS the
  // story while a draw is live adopts it — shimmer up, Stop armed — with no
  // interaction and no UI. One 204 when nothing is drawing.
  React.useEffect(() => {
    attach(null)
  }, [attach])

  /** The workspace's handover: the refreshed tree carries the row now. */
  const settle = React.useCallback(() => {
    setJob((prev) => (prev && prev.landedImageId !== null ? null : prev))
  }, [])

  return { job, generate, stop, settle, attach }
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
        // Flush. A multibyte character split across the final network chunk
        // stays inside the decoder until it is called with no argument, and em
        // dashes and curly quotes are exactly what a literary model emits, so
        // the dropped character is not a hypothetical one.
        const tail = decoder.decode()
        if (tail !== "") {
          text += tail
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
