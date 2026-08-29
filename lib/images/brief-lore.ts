// lib/images/brief-lore.ts — Which lorebook entries a written brief summons.
//
// Pure and isomorphic, and that is the entire reason it exists as its own
// module rather than a few lines inside the route: the composer draws a chip
// per matched entry as the writer types, and the develop call feeds those same
// entries to the model. Two implementations of "what does this brief match"
// would eventually disagree, and the disagreement would be invisible — chips
// promising a character the model was never told about.
//
// Built on matchActiveLorebookEntries rather than beside it, so always-active
// entries, the cascade and the priority ordering are the same machinery the
// story window uses. The brief simply takes the story's seat as the one scan
// source: it IS the prose for this call.

import {
  matchActiveLorebookEntries,
  type LoreMatch,
} from "@/lib/generation/lorebook"
import type { LorebookEntry } from "@/lib/types"

/**
 * The entries a brief activates, ordered priority DESC then depth ASC.
 *
 * An empty brief still returns the always-active entries, and deliberately: a
 * writer whose lorebook says "every picture in this story has the two moons in
 * the sky" means it whether or not they typed the word moon. The caller decides
 * whether an empty brief is a develop call at all — that is the V1 story-window
 * path, not this one.
 */
export function matchBriefLore(
  entries: LorebookEntry[],
  brief: string
): LoreMatch[] {
  return matchActiveLorebookEntries(entries, [
    { id: "story", text: brief.toLowerCase() },
  ])
}

/**
 * How much lore content a develop call will carry, in characters (~4k tokens).
 *
 * A backstop, not a budget in the composeContext sense: a brief naming two
 * characters in a dense lorebook can cascade into forty entries three hops
 * out, and past a point the pile stops sharpening the scene and starts
 * drowning it — the same dilution the brief exists to avoid, arriving through
 * the side door. Generous enough that it never binds on a lorebook whose
 * cards are cards; when it does bind, the priority-DESC/depth-ASC order means
 * what falls off is the far end of the cascade, not anything the brief named.
 */
export const BRIEF_LORE_CHAR_BUDGET = 16_000

/**
 * The entries a develop call actually carries: matched, minus the writer's
 * muted chips, trimmed to the budget in match order.
 *
 * One function used by BOTH the composer (for the ids it records on the draw)
 * and the route (for the contents it hands the model), for the same reason
 * matchBriefLore is shared: two answers to "what rides" would drift, and the
 * drift would be invisible. Exclusions are applied BEFORE the trim, so muting
 * a long entry hands its room to the next in line on both sides at once.
 */
export function selectBriefLore(
  entries: LorebookEntry[],
  brief: string,
  excludedIds: ReadonlySet<string>
): LoreMatch[] {
  const selected: LoreMatch[] = []
  let spent = 0
  for (const match of matchBriefLore(entries, brief)) {
    if (excludedIds.has(match.entry.id)) continue
    const cost = match.entry.content.length
    if (spent + cost > BRIEF_LORE_CHAR_BUDGET) continue
    selected.push(match)
    spent += cost
  }
  return selected
}
