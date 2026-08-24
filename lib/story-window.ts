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
