"use client"

// hooks/use-store.ts — React's view of the client store.
//
// useSyncExternalStore rather than context: the store is a module singleton
// that moves from the socket, the queue and the snapshot lane, none of which is
// inside a React tree. getView returns a cached identity between changes and
// getServerView a frozen empty one, which is what keeps SSR and hydration from
// disagreeing about a cache the server cannot have.

import * as React from "react"

import {
  clientStore,
  type LoreView,
  type StoreView,
  type StoryView,
  type TableStatus,
} from "@/lib/store/store"

export function useStoreView(): StoreView {
  return React.useSyncExternalStore(
    clientStore.subscribe,
    clientStore.getView,
    clientStore.getServerView
  )
}

export function useStories(): { rows: StoryView[]; status: TableStatus } {
  const view = useStoreView()
  return React.useMemo(
    () => ({ rows: view.stories, status: view.storyStatus }),
    [view]
  )
}

/**
 * One story's lorebook, with the pending overlay folded in.
 *
 * Subscribes to the whole store rather than the one table, like every other
 * hook here — getLoreView is memoized against the store version, so a change to
 * an unrelated table costs a map lookup rather than a re-sort.
 */
export function useLorebook(storyId: string): LoreView {
  const subscribe = React.useCallback(
    (onChange: () => void) => clientStore.subscribe(onChange),
    []
  )
  const getSnapshot = React.useCallback(
    () => clientStore.getLoreView(storyId),
    [storyId]
  )
  return React.useSyncExternalStore(subscribe, getSnapshot, EMPTY_LORE)
}

/** Frozen so the server snapshot has a stable identity across renders. */
const EMPTY_LORE_VIEW: LoreView = Object.freeze({
  entries: [],
  status: "empty" as TableStatus,
})

function EMPTY_LORE(): LoreView {
  return EMPTY_LORE_VIEW
}

/**
 * Empty entries alone are not an empty lorebook — they are also a partition
 * whose read has not landed. Mirrors showLibrarySkeleton exactly.
 */
export function showLorebookSkeleton(view: LoreView): boolean {
  return view.entries.length === 0 && view.status !== "live"
}

/** Nonzero while writes are applied-but-unconfirmed — the "Saving…" affordance. */
export function useMutationQueueDepth(): number {
  return useStoreView().pendingCount
}

/** Local, instant search over the loaded rows. Same fields the sidebar showed. */
export function filterStories(rows: StoryView[], query: string): StoryView[] {
  const needle = query.trim().toLowerCase()
  if (needle === "") return rows
  return rows.filter(
    (row) =>
      row.title.toLowerCase().includes(needle) ||
      row.genre.toLowerCase().includes(needle) ||
      row.description.toLowerCase().includes(needle)
  )
}

/**
 * Empty rows alone are not an empty library — they are also a boot whose
 * snapshot has not landed. Only a complete apply can license "write your first
 * story"; everything before it is a skeleton.
 */
export function showLibrarySkeleton(
  rows: readonly unknown[],
  status: TableStatus
): boolean {
  return rows.length === 0 && status !== "live"
}
