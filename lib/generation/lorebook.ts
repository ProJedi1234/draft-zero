// lib/generation/lorebook.ts — Real trigger matching for lorebook entries.
// Replaces the milestone-1 mocked `activeLorebookEntryIds`: the DB read layer
// (getStory), composeContext, and the inspector Lore tab all call these.

import type { LorebookEntry, StoryEntry } from "@/lib/types"

/** How many trailing entries the scan window looks at. */
const SCAN_ENTRY_COUNT = 4
/** Hard character cap on the scan window. */
const SCAN_CHAR_LIMIT = 4000

export interface LoreMatch {
  entry: LorebookEntry
  matchedKey: string | null
}

/** The scan window: last 4 entries' text joined with "\n\n", then the final 4000 chars, lowercased. */
export function recentStoryText(entries: StoryEntry[]): string {
  const recent = entries.slice(-SCAN_ENTRY_COUNT)
  const joined = recent.map((entry) => entry.text).join("\n\n")
  return joined.slice(-SCAN_CHAR_LIMIT).toLowerCase()
}

/**
 * An entry is active iff enabled AND (alwaysActive OR any trigger key — trimmed,
 * lowercased, non-empty — is a substring of the scan window). matchedKey = first
 * matching key in array order (null when only alwaysActive applies; an
 * alwaysActive entry whose key also matches reports that key). Result ordered
 * priority DESC, then id ASC.
 */
export function matchActiveLorebookEntries(
  entries: LorebookEntry[],
  recentText: string
): LoreMatch[] {
  const window = recentText.toLowerCase()
  const matches: LoreMatch[] = []

  for (const entry of entries) {
    if (!entry.enabled) continue

    let matchedKey: string | null = null
    for (const key of entry.keys) {
      const needle = key.trim().toLowerCase()
      if (needle === "") continue
      if (window.includes(needle)) {
        matchedKey = key
        break
      }
    }

    if (matchedKey === null && !entry.alwaysActive) continue
    matches.push({ entry, matchedKey })
  }

  return matches.sort(
    (a, b) =>
      b.entry.priority - a.entry.priority ||
      (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0)
  )
}
