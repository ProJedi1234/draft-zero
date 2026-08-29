"use client"

// hooks/use-workspace-payload.ts — What the story shell paints, and when.
//
// Cached payload first (no network, no await), then a fetch that corrects it.
// The `revision` argument is the seam that keeps this honest: the story route
// re-renders on every router.refresh() the app already performs — a generation
// settling, undo, a lorebook edit, a sync `change` — and hands down a new value
// each time, so every existing refresh path repaints the workspace exactly as
// it did when the route fetched the props itself.

import * as React from "react"

import { useStoreView } from "@/hooks/use-store"
import {
  fetchWorkspacePayload,
  getCachedPayload,
  subscribe as subscribeToWorkspaceCache,
} from "@/lib/story/workspace-cache"
import type { StoryWorkspacePayload } from "@/lib/story/workspace-payload"

export type WorkspaceState = "ready" | "loading" | "missing" | "error"

/** How long a 404 on a story the queue is still creating is treated as "not yet". */
const PENDING_CREATE_RETRY_MS = 250

export function useWorkspacePayload(
  storyId: string,
  revision: string
): { payload: StoryWorkspacePayload | null; state: WorkspaceState } {
  const view = useStoreView()
  // A create the queue has not confirmed yet. Its row is in the store the
  // instant the button is pressed, which is why the shell can paint a title
  // for a story the server has never heard of.
  const isPendingCreate = view.storyById.get(storyId)?.pending === true

  const [current, setCurrent] = React.useState(() => seed(storyId))

  // Adjusting state during render rather than keying the component: a key on
  // the loader would remount the workspace on every switch, and the inspector's
  // open/closed state is deliberately not per-story.
  if (current.storyId !== storyId) setCurrent(seed(storyId))

  // The cache is empty at mount on a cold load — IndexedDB opens in the boot
  // effect, which lands a beat after this one reads it. Without this the disk
  // cache could only ever help the SECOND story of a session, which is the
  // opposite of what it is for: paint on relaunch.
  //
  // Only ever fills a blank: anything already on screen came from a live fetch
  // and is at least as fresh as the disk.
  React.useEffect(() => {
    return subscribeToWorkspaceCache(() => {
      setCurrent((prev) => {
        if (prev.storyId !== storyId || prev.payload !== null) return prev
        const cached = getCachedPayload(storyId)
        return cached === undefined
          ? prev
          : { storyId, payload: cached, state: "ready" }
      })
    })
  }, [storyId])

  React.useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const run = async (): Promise<void> => {
      const outcome = await fetchWorkspacePayload(storyId)
      if (cancelled) return

      if (outcome.kind === "ok") {
        // Keep the object we are already showing when the correction says the
        // same thing. Re-seating an identical payload costs a full re-render of
        // the manuscript — a quarter-second of blocked main thread on a long
        // story — to arrive at the pixels already on screen. Revisiting a story
        // nothing has touched is the common case, so this is most revisits.
        setCurrent((prev) =>
          prev.storyId === storyId &&
          prev.payload !== null &&
          samePayload(prev.payload, outcome.payload)
            ? prev
            : { storyId, payload: outcome.payload, state: "ready" }
        )
        return
      }

      if (outcome.kind === "missing") {
        // The insert has not landed yet. Keep the shell up and ask again rather
        // than showing "not found" for a story the writer just created.
        if (isPendingCreate) {
          timer = setTimeout(() => void run(), PENDING_CREATE_RETRY_MS)
          return
        }
        setCurrent({ storyId, payload: null, state: "missing" })
        return
      }

      // A failed correction never blanks a payload already on screen.
      setCurrent((prev) =>
        prev.payload === null
          ? { storyId, payload: null, state: "error" }
          : { ...prev, state: "ready" }
      )
    }

    void run()

    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [storyId, revision, isPendingCreate])

  return { payload: current.payload, state: current.state }
}

/**
 * Exact, not a fingerprint: a cheap comparison that misses a change leaves the
 * writer looking at a stale manuscript, which is a far worse failure than the
 * few milliseconds this costs on a payload of a couple of hundred kilobytes.
 */
function samePayload(
  a: StoryWorkspacePayload,
  b: StoryWorkspacePayload
): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function seed(storyId: string): {
  storyId: string
  payload: StoryWorkspacePayload | null
  state: WorkspaceState
} {
  const cached = getCachedPayload(storyId) ?? null
  return {
    storyId,
    payload: cached,
    state: cached === null ? "loading" : "ready",
  }
}
