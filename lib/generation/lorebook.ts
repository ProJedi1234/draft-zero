// lib/generation/lorebook.ts — Trigger matching for lorebook entries.
// The DB read layer (getStory), composeContext, and the inspector Lore tab all
// call these.
//
// Activation has three parts, and they are separable on purpose:
//   1. WHERE we look — the scan sources: a window of recent prose, plus memory
//      and the author's note, which the writer wrote deliberately and which do
//      not scroll away.
//   2. WHAT activates — a key seen in a source, or alwaysActive.
//   3. WHAT THAT activates in turn — the cascade: an active entry's own text is
//      scanned for further keys, so a lorebook can express "the elves fled to
//      Elvenhome after the Sundering" and have the Sundering arrive with it.

import type { LorebookEntry, StoryEntry } from "@/lib/types"

// The scan window is deliberately fixed and independent of the story's
// contextWindow: this is *activation*, not *budgeting*. If the window moved with
// the slider, dragging it would silently change which entries trigger.
/** How many trailing entries the scan window looks at. */
const SCAN_ENTRY_COUNT = 4
/** Hard character cap on the scan window. */
const SCAN_CHAR_LIMIT = 4000

/**
 * How many rounds of cascade run past the direct matches.
 *
 * A constant rather than a setting, in the same spirit as the two above: three
 * hops is far enough for the association a writer actually means ("this place
 * implies that war implies that king") and short enough that a densely
 * cross-referencing lorebook cannot quietly pull itself entirely into context.
 */
export const MAX_CASCADE_DEPTH = 3

/** Where a direct match was found. */
export type LoreScanSourceId = "memory" | "authorsNote" | "story"

/** One place keys are looked for, already lowercased. */
export interface LoreScanSource {
  id: LoreScanSourceId
  text: string
}

/**
 * Why an entry is in context: a scan source, another entry that named it, or
 * nothing at all (alwaysActive).
 */
export type LoreTrigger =
  | { kind: "source"; source: LoreScanSourceId }
  | { kind: "lore"; id: string; name: string }

export interface LoreMatch {
  entry: LorebookEntry
  matchedKey: string | null
  /** Rounds from a scan source. 0 is a direct match or alwaysActive. */
  depth: number
  /** What put it here, or null when it is simply always on. */
  triggeredBy: LoreTrigger | null
  /**
   * True when nothing about this entry's activation depends on the story
   * window — always-on, or reached from memory/the author's note alone.
   *
   * This is what the context layout splits on: a stable entry cannot appear or
   * vanish because the prose scrolled, so it can sit in the cacheable head of
   * the prompt, while a volatile one belongs down by the recent text that
   * summoned it. See composeContext.
   */
  stable: boolean
}

/** The scan window: last 4 entries' text joined with "\n\n", then the final 4000 chars, lowercased. */
export function recentStoryText(entries: StoryEntry[]): string {
  const recent = entries.slice(-SCAN_ENTRY_COUNT)
  const joined = recent.map((entry) => entry.text).join("\n\n")
  return joined.slice(-SCAN_CHAR_LIMIT).toLowerCase()
}

/**
 * Everywhere a trigger key is looked for, most durable first.
 *
 * Order is load-bearing: the first source that matches is the one an entry is
 * attributed to, and memory/author's-note attribution is what marks an entry
 * stable. A name written in Memory should keep its lore in context whether or
 * not the last four passages happened to mention it — and should keep it in
 * the same place in the prompt every turn, which is the caching half of the
 * same fact. Memory and the note are sent whole rather than windowed: they are
 * short by construction and the writer chose every word.
 */
export function buildScanSources(story: {
  entries: StoryEntry[]
  memory: string
  authorsNote: string
}): LoreScanSource[] {
  return [
    { id: "memory", text: story.memory.toLowerCase() },
    { id: "authorsNote", text: story.authorsNote.toLowerCase() },
    { id: "story", text: recentStoryText(story.entries) },
  ]
}

/** The first key of `entry` present in `haystack`, or null. */
function firstMatchingKey(
  entry: LorebookEntry,
  haystack: string
): string | null {
  for (const key of entry.keys) {
    const needle = key.trim().toLowerCase()
    if (needle === "") continue
    if (haystack.includes(needle)) return key
  }
  return null
}

/** Priority DESC, then depth ASC, then id ASC. */
function compareMatches(a: LoreMatch, b: LoreMatch): number {
  return (
    b.entry.priority - a.entry.priority ||
    a.depth - b.depth ||
    (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0)
  )
}

/**
 * Which entries are in context, and why.
 *
 * Round 0 scans the sources: an entry is active iff enabled AND (alwaysActive
 * OR one of its keys appears in a source). Each later round scans only the
 * *content of the entries the previous round activated*, so the active set
 * grows monotonically and the loop cannot revisit an entry — which is what
 * makes a cyclic lorebook (A names B, B names A) terminate rather than hang.
 * MAX_CASCADE_DEPTH bounds it regardless.
 *
 * `matchedKey` stays what it always was: the first matching key in array order,
 * null when only alwaysActive applies. An alwaysActive entry whose key also
 * matches still reports that key.
 *
 * Result ordered priority DESC, depth ASC, id ASC — so at equal priority an
 * entry the prose actually named survives trimming before one that arrived by
 * association.
 */
export function matchActiveLorebookEntries(
  entries: LorebookEntry[],
  sources: LoreScanSource[]
): LoreMatch[] {
  const candidates = entries.filter((entry) => entry.enabled)
  const active = new Map<string, LoreMatch>()

  // Round 0 — the scan sources.
  for (const entry of candidates) {
    let matchedKey: string | null = null
    let trigger: LoreTrigger | null = null
    let stable = false

    for (const source of sources) {
      const key = firstMatchingKey(entry, source.text)
      if (key === null) continue
      matchedKey = key
      trigger = { kind: "source", source: source.id }
      stable = source.id !== "story"
      break
    }

    if (entry.alwaysActive) {
      // Always on outranks however it was found: the entry is in context
      // because the writer said so, and nothing about the prose can change
      // that — which also makes it unconditionally stable.
      active.set(entry.id, {
        entry,
        matchedKey,
        depth: 0,
        triggeredBy: null,
        stable: true,
      })
      continue
    }
    if (trigger === null) continue
    active.set(entry.id, {
      entry,
      matchedKey,
      depth: 0,
      triggeredBy: trigger,
      stable,
    })
  }

  // Rounds 1..MAX_CASCADE_DEPTH — each active entry's own text is a scan source
  // for the entries it names.
  let frontier = [...active.values()].sort(compareMatches)
  for (let depth = 1; depth <= MAX_CASCADE_DEPTH; depth += 1) {
    if (frontier.length === 0) break
    const reached: LoreMatch[] = []

    for (const entry of candidates) {
      if (active.has(entry.id)) continue
      for (const source of frontier) {
        const key = firstMatchingKey(entry, source.entry.content.toLowerCase())
        if (key === null) continue
        reached.push({
          entry,
          matchedKey: key,
          depth,
          triggeredBy: {
            kind: "lore",
            id: source.entry.id,
            name: source.entry.name,
          },
          // An association is only as stable as what it hangs from: an entry
          // pulled in by a story-triggered entry disappears when that one does.
          stable: source.stable,
        })
        break
      }
    }

    for (const match of reached) active.set(match.entry.id, match)
    frontier = reached.sort(compareMatches)
  }

  return [...active.values()].sort(compareMatches)
}

/**
 * How an entry's arrival reads in the UI: "Always on", "via Memory", "via
 * Elvenhome". One function so the inspector card and the context viewer cannot
 * word the same fact two different ways.
 */
export function describeTrigger(trigger: LoreTrigger | null): string {
  if (trigger === null) return "Always on"
  if (trigger.kind === "lore") return `via ${trigger.name}`
  switch (trigger.source) {
    case "memory":
      return "via Memory"
    case "authorsNote":
      return "via Author's note"
    case "story":
      return "via recent text"
  }
}
