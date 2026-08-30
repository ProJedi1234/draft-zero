// lib/story-window.ts — Merging paged-in older passages with the server tail.
//
// Client-side and pure. The tail arrives fresh on every RSC refresh; the older
// pages live in canvas state. The two can overlap: the tail window is sized by
// the effective context window, so a settings change (or simply new prose
// accumulating) slides its start across passages the reader already paged in.
// The TAIL's copy wins every overlap — it is the fresher read.

import type { StoryEntry } from "@/lib/types"

/** Older pages then the tail, deduped by id; `older` must be position ASC. */
export function mergeWindowedEntries(
  older: StoryEntry[],
  tail: StoryEntry[]
): StoryEntry[] {
  if (older.length === 0) return tail
  const tailIds = new Set(tail.map((entry) => entry.id))
  return [...older.filter((entry) => !tailIds.has(entry.id)), ...tail]
}

/**
 * Re-seats the held older pages on a fresh read of the range below the tail
 * window. `pageStart` is that read's oldest position, so the page is the whole
 * authoritative truth for [pageStart, windowStart) — held passages in that
 * range are REPLACED by it, and only prose older than the page survives
 * untouched, because nothing read it.
 *
 * Replacing a range rather than merging by id is what lets a removal and a
 * restoration both land: a rewind from a passage the reader scrolled up to
 * cuts prose that lives only here, and the undo that takes the rewind back
 * puts it here again. Merging by id could express neither.
 *
 * This is emphatically NOT the count-sized replacement this once was. That one
 * dropped whichever rows a page landing had added while it was in flight; this
 * keeps every one of them, because they sit below the read's floor.
 */
export function reconcileHeldEntries(
  held: StoryEntry[],
  page: StoryEntry[],
  pageStart: number | null
): StoryEntry[] {
  // A null floor is a read that found nothing live below the window at all —
  // an empty range, so every held passage in it is gone.
  const unread = held.filter(
    (entry) =>
      // Fixture entries carry no position, so no read can speak for them.
      entry.position === undefined ||
      (pageStart !== null && entry.position < pageStart)
  )
  return [...unread, ...page]
}
