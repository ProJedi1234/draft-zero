// lib/generation/summary-plan.ts — What to summarize, and how long the result
// may be. Pure and isomorphic: no database, no provider, no clock.
//
// Split out from the summarizer itself because this is where every decision
// that can be wrong lives. The call is mechanical; choosing the batch is not,
// and it is the half that has to be right about a story being rewound, edited,
// switched on late, or squeezed by a smaller window.

import type { StoryEntry } from "@/lib/types"

import { manuscriptWithOffsets } from "./context"

/**
 * Share of the context window the recap may aim for, and the bounds on it.
 *
 * Expressed in words because that is what the summarizer is actually told, and
 * a model follows a word count far better than a token count. Five percent of
 * the window, converted at the usual ~0.75 words per token: about 307 words at
 * the 8k default, which is a paragraph and a half — enough to carry a name, a
 * debt and an injury without becoming a second manuscript.
 *
 * The floor keeps a small window from asking for a recap too short to say
 * anything. The ceiling binds from roughly 16k up, on the view that past a few
 * hundred words a longer recap is bulk rather than better recall: the model
 * already has the recent prose in full, and what it needs from the distant past
 * is the facts, not the texture.
 */
const TARGET_SHARE = 0.05
const WORDS_PER_TOKEN = 0.75
const TARGET_MIN_WORDS = 150
const TARGET_MAX_WORDS = 600

/**
 * How many words this story's recap should aim for.
 *
 * `override` is the writer's fixed choice from Settings; null means scale with
 * the window, which is the default and the better rule — a number that suits a
 * 128k window is most of an 8k one. An override is taken as given rather than
 * clamped to the share above: it is a deliberate instruction, and clamping it
 * would silently ignore what was asked for.
 */
export function summaryWordTarget(
  contextWindow: number,
  override: number | null = null
): number {
  if (override !== null) return Math.max(1, Math.round(override))
  return Math.min(
    TARGET_MAX_WORDS,
    Math.max(
      TARGET_MIN_WORDS,
      Math.round(contextWindow * TARGET_SHARE * WORDS_PER_TOKEN)
    )
  )
}

/** The batch to fold in, and the passage the new version will cover through. */
export interface SummaryPlan {
  /** Prose to fold in, rendered exactly as the prompt renders it. */
  newProse: string
  throughEntryId: string
  throughPosition: number
}

/**
 * Decide whether to summarize, and what.
 *
 * Two rules do all the work here.
 *
 * **Stay a quantum ahead.** The window's leading edge does not creep, it holds
 * still and then jumps by one quantum (see context.ts). The batch that is about
 * to fall off is summarized BEFORE it does, so the recap is already written the
 * moment the prose leaves view. The cost is a deliberate overlap — for a while
 * the same passage is both summarized and visible in full — and the thing it
 * buys is that there is never a turn where prose is in neither place.
 *
 * **Never walk backward.** If coverage is behind the window's start — a story
 * that outgrew its window before this feature existed, or one whose window the
 * writer just made smaller — the gap is SKIPPED, not caught up. Summarizing
 * from the current edge is one call; walking a month of writing back to the
 * beginning is dozens, sequential, and firing on its own. Prose in the gap stays
 * exactly as forgotten as it already was, which is no worse than the behaviour
 * this feature is improving on.
 *
 * Returns null when there is nothing to do, which is the common answer: a story
 * that still fits its window never summarizes at all.
 */
export function planSummary(input: {
  entries: StoryEntry[]
  /** composeContext's own record of where this turn's window began. */
  trim: { windowStart: number; quantum: number }
  /** The version currently in force, or null when the story has none. */
  recap: { throughEntryId: string } | null
}): SummaryPlan | null {
  const { entries, trim, recap } = input
  // Nothing has fallen out of the window, so there is nothing the model cannot
  // already see. Short stories live here forever and never cost a penny.
  if (trim.windowStart <= 0) return null

  const { text, ends } = manuscriptWithOffsets(entries)
  if (ends.length === 0) return null

  const coveredIndex = recap
    ? entries.findIndex((entry) => entry.id === recap.throughEntryId)
    : -1
  // A recap that resolved must name a live passage, so -1 here means "no recap"
  // rather than a dangling reference — but treating the two the same is also
  // the safe reading if that ever stops holding.
  const coveredEnd = coveredIndex === -1 ? 0 : ends[coveredIndex]!

  // Snapped to a passage boundary so a batch never begins mid-sentence. Only
  // reachable on the first run and after a gap; in the steady state `from` is
  // the previous version's own end, which is a boundary already.
  const from = Math.max(coveredEnd, snapDown(ends, trim.windowStart))
  const target = trim.windowStart + trim.quantum
  if (from >= target) return null

  // The last passage that ends within the target, or — when even the first one
  // overshoots it — that first passage anyway. Overshooting by one passage is
  // better than the alternative, which is returning null forever and never
  // summarizing a story whose passages are longer than a quantum.
  let through = -1
  for (let index = 0; index < ends.length; index += 1) {
    if (ends[index]! <= from) continue
    through = index
    if (ends[index]! >= target) break
  }
  if (through === -1) return null

  const entry = entries[through]!
  const newProse = text.slice(from, ends[through]!).trim()
  if (newProse === "") return null

  return {
    newProse,
    throughEntryId: entry.id,
    // Position is the passage's index in the live manuscript. The domain entry
    // carries no position column, and it does not need one: this is only ever
    // compared against other values produced the same way.
    throughPosition: through,
  }
}

/** The largest passage boundary at or before `offset`, or 0. */
function snapDown(ends: number[], offset: number): number {
  let best = 0
  for (const end of ends) {
    if (end > offset) break
    best = end
  }
  return best
}
