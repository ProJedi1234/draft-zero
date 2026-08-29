"use client"

import * as React from "react"
import { toast } from "sonner"

import { stopIllustration } from "@/lib/actions/images"
import { subscribeDeriveRun, subscribeImageRun } from "@/lib/sync/client"
import type { ImageAspectRatio } from "@/lib/types"

/** What the composer hands over when the writer sends an image. */
export interface IllustrateRequest {
  /** What the image model is sent — the scene plus the style sentence. */
  prompt: string
  /**
   * The writer's brief, or null for a verbatim send. Recorded with the picture
   * so the caption can show what was asked for rather than only what was sent,
   * and so a retry can inherit it.
   */
  sourcePrompt: string | null
  /** Lorebook entries the develop call was given. Empty when there was none. */
  promptLoreIds: string[]
  aspectRatio: ImageAspectRatio
  /** Set only by a retry — names the slot the new draw joins. */
  imageGroupId?: string
  /**
   * Set only by the retry menu — draws this one take with the named model,
   * leaving the story's own choice untouched.
   */
  modelId?: string
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
    onRestoreDraft?: (restore: {
      prompt: string
      sourcePrompt: string | null
    }) => void
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

  // Held so a failure can hand the words back; null on attached devices. The
  // brief travels with the sent prompt because it is the half the writer typed:
  // handing back only what went to the provider would return them a developed
  // paragraph in place of their own sentence.
  const promptRef = React.useRef<{
    prompt: string
    sourcePrompt: string | null
  } | null>(null)

  const restoreDraft = React.useCallback(() => {
    const held = promptRef.current
    promptRef.current = null
    if (held !== null) optionsRef.current.onRestoreDraft?.(held)
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
                  ? {
                      ...prev,
                      previewB64: event.b64,
                      mediaType: event.mediaType,
                    }
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
      promptRef.current = {
        prompt: request.prompt,
        sourcePrompt: request.sourcePrompt,
      }

      try {
        const res = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storyId,
            prompt: request.prompt,
            sourcePrompt: request.sourcePrompt,
            promptLoreIds: request.promptLoreIds,
            aspectRatio: request.aspectRatio,
            imageGroupId: request.imageGroupId,
            modelId: request.modelId,
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
 * Mirrors a story's live prompt DERIVATION — whoever started it.
 *
 * Explicitly invoked — there is no auto-derive on entering image mode. This is
 * a real model call with a real price, and a mode toggle that silently bills
 * the writer is the kind of surprise a spend ledger exists to prevent. The wand
 * is one tap, and one tap is cheap enough.
 *
 * Structurally the twin of useImageGeneration above, and for the same reason:
 * the develop is a detached run on the server (lib/images/derive-run.ts) and
 * this hook is a pure subscriber. `develop` launches one and watches it;
 * `attach` watches one another device launched (handed over via
 * derive-run-started) or probes "is anything developing?" with a null runId on
 * mount and reconnect. Switching stories detaches and nothing more — and there
 * is no stop at all, because a develop is over in seconds and the writer's
 * cheapest out is to let it land and edit it.
 *
 * `deriving` is therefore true on EVERY device while a run is live, which is
 * what makes the composer's locked brief, spinner and send slot work on the
 * second device without any of them knowing this is a shared run.
 */
export function useImagePromptDerivation(
  storyId: string,
  options: {
    /**
     * The prompt SO FAR, on every increment. Display only — the composer shows
     * it, and nobody publishes it: a sentence still being written is not a
     * draft worth shipping to the writer's other devices a chunk at a time.
     * The settled text arrives as a `draft` event the run itself publishes.
     */
    onText: (textSoFar: string) => void
    /**
     * The run ended with a settled prompt — already persisted and announced by
     * the run itself. Unlike onText this is the moment the lane's PUBLISHED
     * value must catch up too: the run's own `draft` event loses to any save
     * of ours still in flight (shouldAdoptDraft), and a device left holding a
     * pre-develop published value would clobber the settled prompt with it on
     * its next publish.
     */
    onSettle: (text: string) => void
    /**
     * The run ended with nothing to show — an error, or a story deleted under
     * it. Fold the lane away. `persist` is true only on the device that
     * launched: the fold is a state worth writing down once, and N devices
     * racing to write down the same emptiness is worse than one.
     */
    onDiscard: (opts: { persist: boolean }) => void
  }
) {
  const [deriving, setDeriving] = React.useState(false)
  // Which brief the live — or most recently finished — run is answering. The
  // composer dates its lane by this rather than by its own textarea, so a
  // device that attached halfway through still marks staleness against the
  // question that was actually asked. Deliberately NOT cleared on end: the
  // composer reads it on the falling edge of `deriving`, which is that moment.
  const [derivedBrief, setDerivedBrief] = React.useState<string | null>(null)
  // The mutes that brief was asked under — the same falling-edge read, so the
  // composer dates its lane by the run's whole question, not half of it.
  const [derivedExcludedLoreIds, setDerivedExcludedLoreIds] = React.useState<
    string[] | null
  >(null)
  const abortRef = React.useRef<AbortController | null>(null)
  /** True while THIS device is the one that launched the run being watched. */
  const launchedRef = React.useRef(false)
  /** The run this hook is attached to, so a redundant handoff is a no-op. */
  const watchedRunIdRef = React.useRef<string | null>(null)

  const optionsRef = React.useRef(options)
  React.useEffect(() => {
    optionsRef.current = options
  })

  /**
   * The one watch loop. Subscribes (a null runId is the probe), folds frames
   * into the lane, and re-attaches on a dropped stream — the linger window
   * means even a run that finished during the gap still delivers its end frame,
   * which matters more here than anywhere else: `deriving` locks the composer,
   * and a missed end frame would lock it for good.
   */
  const watch = React.useCallback(
    async (runId: string | null) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      watchedRunIdRef.current = runId

      let currentRunId = runId
      let text = ""
      for (let attempt = 0; !controller.signal.aborted; attempt++) {
        let events: AsyncGenerator<
          import("@/lib/sync/types").DeriveRunWireEvent
        > | null
        try {
          events = await subscribeDeriveRun(
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

        // 204: nothing developing (and nothing lingering under that id). For
        // the probe that answer IS the state; for a named run it means the
        // linger window closed. Either way the composer unlocks — the settled
        // prompt, if there was one, arrived as a `draft` event.
        if (events === null) {
          if (!controller.signal.aborted) setDeriving(false)
          return
        }

        try {
          for await (const event of events) {
            if (controller.signal.aborted) return
            if (event.type === "derive-run") {
              currentRunId = event.runId
              watchedRunIdRef.current = event.runId
              text = event.text
              setDerivedBrief(event.brief)
              setDerivedExcludedLoreIds(event.excludedLoreIds)
              setDeriving(true)
              // The snapshot, not a delta: an attacher lands in the middle of
              // a sentence and gets all of it at once.
              optionsRef.current.onText(text)
            } else if (event.type === "text") {
              text += event.value
              optionsRef.current.onText(text)
            } else if (event.type === "end") {
              const launched = launchedRef.current
              launchedRef.current = false
              watchedRunIdRef.current = null
              if (event.status === "error") {
                toast.error(
                  event.error ?? "Couldn't write a prompt for this scene."
                )
              }
              // The end frame's own text is the authority over anything this
              // device accumulated — a socket that dropped and re-attached
              // could have missed increments the snapshot then replaced.
              if (event.status === "ok" && event.text !== "") {
                optionsRef.current.onSettle(event.text)
              } else {
                optionsRef.current.onDiscard({ persist: launched })
              }
              // Last, so the composer's falling edge fires over settled text.
              setDeriving(false)
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
    [storyId]
  )

  // A watcher outlives the composer but not the story: switching stories
  // detaches the listener and nothing else — the develop keeps going without
  // us, and lands in the draft row either way.
  React.useEffect(() => {
    return () => abortRef.current?.abort()
  }, [storyId])

  /**
   * Launches a develop and watches it.
   *
   * An empty `brief` is the V1 gesture: derive from where the story is now.
   * A brief present is the develop call, and `excludedLoreIds` are the chips
   * the writer muted — sent as ids rather than as a filtered lore list because
   * the server does its own matching, and the client's job is to say what to
   * leave out, not to decide what was in.
   */
  const develop = React.useCallback(
    async (
      input: { brief: string; excludedLoreIds: string[] } = {
        brief: "",
        excludedLoreIds: [],
      }
    ) => {
      // Shown before the launch resolves, so the lane opens on the tap rather
      // than a round-trip later — the same reason the image job is set
      // optimistically. Cleared below if the launch is refused.
      launchedRef.current = true
      setDerivedBrief(input.brief)
      setDerivedExcludedLoreIds(input.excludedLoreIds)
      setDeriving(true)
      optionsRef.current.onText("")

      try {
        const res = await fetch("/api/image-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storyId,
            brief: input.brief,
            excludedLoreIds: input.excludedLoreIds,
          }),
        })
        const body = (await res.json().catch(() => null)) as {
          runId?: string
          error?: string
        } | null
        if (!res.ok || !body?.runId) {
          launchedRef.current = false
          // A refusal can mean we lost the launch race to another device, and
          // its derive-run-started may already have attached us to the run we
          // lost to. That watch owns the lane now — unlocking and folding here
          // would discard a live develop mid-stream and publish the fold over
          // its row.
          if (watchedRunIdRef.current === null) {
            toast.error(
              body?.error ?? "Couldn't write a prompt for this scene."
            )
            setDeriving(false)
            // Persisted, unlike an attached device's fold: this tap is the only
            // reason the lane opened at all, and nothing was launched to close
            // it. Leaving it local would show an empty lane over a row that
            // still holds the last developed prompt.
            optionsRef.current.onDiscard({ persist: true })
          }
          return
        }
        // The bus echo of our own launch may have beaten this reply and
        // attached us already; re-watching would drop a live socket for an
        // identical one.
        if (watchedRunIdRef.current !== body.runId) void watch(body.runId)
      } catch {
        launchedRef.current = false
        // Same guard as the refusal above: a network error on the launch call
        // does not mean nothing is running.
        if (watchedRunIdRef.current === null) {
          toast.error("Couldn't write a prompt for this scene.")
          setDeriving(false)
          optionsRef.current.onDiscard({ persist: true })
        }
      }
    },
    [storyId, watch]
  )

  /** Attach to a run someone else started (derive-run-started), or re-probe (null). */
  const attach = React.useCallback(
    (runId: string | null) => {
      // Already watching that very run — including the echo of our own launch,
      // which comes back around the bus like anyone else's. A reattach would
      // drop the socket to open an identical one.
      if (runId !== null && watchedRunIdRef.current === runId) return
      void watch(runId)
    },
    [watch]
  )

  // The magic moment, same as the other two channels': a device that merely
  // OPENS the story while a develop is live adopts it — lane open, brief
  // locked — with no interaction and no UI. One 204 when nothing is running.
  React.useEffect(() => {
    attach(null)
  }, [attach])

  return { deriving, derivedBrief, derivedExcludedLoreIds, develop, attach }
}
