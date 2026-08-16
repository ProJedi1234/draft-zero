// lib/generation/breakdown.ts — What a composed context is made of.
//
// Pure and isomorphic, like context.ts: the inspector runs it on a context it
// composed a moment ago, and the viewer runs it on one stored months ago. It
// reads nothing but the ComposedContext it is handed, so a snapshot taken at
// generation time breaks down identically forever, whatever the story has since
// become.
//
// The breakdown is built by SLICING the prompt this context renders, never by
// searching the finished string for bracket labels. Every section's `text` is a
// literal span of what was sent, and the spans concatenate back to the whole
// prompt — so the bar cannot show a story about a prompt that was not the one
// on the wire.

import { estimateTokens, promptBlocks } from "./context"
import type { ComposedContext, ContextSectionId } from "./types"

/** Writer-facing names. "Instructions" rather than "System prompt": the panel
 * that edits it calls it a system prompt, but what the reader is being shown
 * here is the narrator's standing brief. */
export const CONTEXT_SECTION_LABELS: Record<ContextSectionId, string> = {
  system: "Instructions",
  memory: "Memory",
  lore: "Lorebook",
  story: "Story",
  authorsNote: "Author's note",
}

/** Bar order, and therefore shade order — the order the model reads them in. */
export const CONTEXT_SECTION_ORDER: readonly ContextSectionId[] = [
  "system",
  "memory",
  "lore",
  "story",
  "authorsNote",
]

/** One lore entry inside the Lorebook section. */
export interface ContextItem {
  id: string
  label: string
  tokens: number
  /** Why it is here: the trigger key that matched, or null for always-active. */
  matchedKey: string | null
  /** The block as sent, label and all. */
  text: string
}

/** One contiguous piece of the prompt, tagged with the section that owns it. */
export interface ContextSpan {
  section: ContextSectionId
  text: string
}

export interface ContextSection {
  id: ContextSectionId
  label: string
  /** estimateTokens over this section's spans. */
  tokens: number
  chars: number
  /**
   * Every span of this section, joined. For four of the five that is a literal
   * slice of the prompt; the story is the exception, because the author's note
   * is injected BETWEEN the manuscript's head and its final paragraph. Joining
   * the two halves is the honest thing to show a writer — it is the prose, as
   * prose — and `spans` below is where the true wire order lives.
   */
  text: string
  /**
   * How much of what this source offered actually fit, 0–1. Null for the
   * sections nothing can trim (instructions, memory, author's note): a fraction
   * that is always 1 says nothing, and a meter under it invites the reading
   * that it could have been less.
   */
  fit: number | null
  /** One sentence about that, in the writer's terms. */
  fitNote: string
  /** Lore only; empty everywhere else. */
  items: ContextItem[]
}

export interface ContextBreakdown {
  /** Only the sections that actually contributed something, in bar order. */
  sections: ContextSection[]
  /**
   * The prompt in WIRE order, tagged and cut into the pieces the sections are
   * grouped from. Joining these gives back `systemPrompt + renderPrompt(ctx)`
   * exactly, separators and all — which is the invariant everything else here
   * rests on, and the reason it is exposed rather than kept private.
   */
  spans: ContextSpan[]
  /**
   * The whole prompt's estimate — ctx.approxTokens, NOT the sum of the sections
   * above. estimateTokens rounds up per string, so summing five sections
   * over-counts by up to five tokens against the one number that was ever
   * measured. The sections are the shape; this is the size.
   */
  usedTokens: number
  windowTokens: number
  /** Window left over. 0 when the context overshot it. */
  freeTokens: number
  /**
   * True when the fixed overhead alone did not fit the window — composeContext
   * trims "whenever achievable", and this is when it wasn't.
   */
  overflowing: boolean
}

/**
 * Slice a composed context into the bands the viewer draws.
 *
 * `windowTokens` is the budget it was composed against, which is NOT recoverable
 * from the context itself — the same prose fits a 32k window comfortably and
 * overflows an 8k one, and only the caller knows which was in force.
 */
export function describeContext(
  ctx: ComposedContext,
  windowTokens: number
): ContextBreakdown {
  const items: ContextItem[] = []
  // The system prompt is prepended with no separator, exactly as measure() and
  // every provider concatenate it.
  const spans: ContextSpan[] = [{ section: "system", text: ctx.systemPrompt }]

  promptBlocks(ctx).forEach((block, index) => {
    // The separator belongs to the block it precedes, so the spans concatenate
    // back to systemPrompt + renderPrompt(ctx) with nothing left over.
    spans.push({
      section: block.section,
      text: index === 0 ? block.text : `\n\n${block.text}`,
    })
    if (block.section !== "lore" || block.loreId === undefined) return
    const entry = ctx.lore.find((lore) => lore.id === block.loreId)
    if (!entry) return
    items.push({
      id: entry.id,
      label: entry.name,
      tokens: estimateTokens(block.text),
      matchedKey: entry.matchedKey,
      text: block.text,
    })
  })

  const sections: ContextSection[] = []
  for (const id of CONTEXT_SECTION_ORDER) {
    const text = spans
      .filter((span) => span.section === id)
      .map((span) => span.text)
      .join("")
    // An empty section is not rendered as a zero row: memory nobody wrote and
    // memory that was dropped look identical in a list of zeros, and only one
    // of those is worth a writer's attention (it is reported on the section
    // that did the dropping instead).
    if (text.trim() === "") continue
    sections.push({
      id,
      label: CONTEXT_SECTION_LABELS[id],
      tokens: estimateTokens(text),
      chars: text.length,
      text,
      fit: sectionFit(id, ctx),
      fitNote: sectionNote(id, ctx),
      items: id === "lore" ? items : [],
    })
  }

  return {
    sections,
    spans,
    usedTokens: ctx.approxTokens,
    windowTokens,
    freeTokens: Math.max(0, windowTokens - ctx.approxTokens),
    overflowing: ctx.approxTokens > windowTokens,
  }
}

/** 0–1 for the two sections the budget can trim; null for the rest. */
function sectionFit(id: ContextSectionId, ctx: ComposedContext): number | null {
  if (id === "lore") {
    if (ctx.fit.loreMatched === 0) return null
    return ctx.lore.length / ctx.fit.loreMatched
  }
  if (id === "story") {
    if (ctx.fit.storyChars === 0) return null
    return Math.min(1, ctx.fit.storyCharsKept / ctx.fit.storyChars)
  }
  return null
}

function sectionNote(id: ContextSectionId, ctx: ComposedContext): string {
  switch (id) {
    case "system":
      return "The narrator's standing brief. Always sent whole."
    case "memory":
      return "Sent whole, ahead of everything else."
    case "authorsNote":
      return "Sent whole, just before the most recent paragraph."
    case "lore": {
      const kept = ctx.lore.length
      const matched = ctx.fit.loreMatched
      if (matched === 0) return "Nothing in the lorebook was triggered."
      if (kept === matched) {
        return `All ${matched} triggered ${plural(matched, "entry", "entries")} fit.`
      }
      // The one thing this whole feature exists to be able to say.
      return `${kept} of ${matched} triggered entries fit — ${matched - kept} ${plural(matched - kept, "was", "were")} trimmed for space.`
    }
    case "story": {
      const { storyChars, storyCharsKept } = ctx.fit
      if (storyChars === 0) return "This story has no prose yet."
      if (storyCharsKept >= storyChars) return "The whole manuscript fit."
      return `The last ${percent(storyCharsKept / storyChars)} of the manuscript fit; earlier passages were trimmed.`
    }
  }
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

/**
 * A share as a percentage, never rounded to a number that contradicts the
 * sentence around it: a manuscript with three of its thousand paragraphs in
 * context reads "<1%", not "0%", and one paragraph short of whole reads "99%",
 * not "100%" beside "earlier passages were trimmed".
 */
function percent(ratio: number): string {
  if (ratio > 0 && ratio < 0.01) return "<1%"
  if (ratio < 1 && ratio > 0.99) return "99%"
  return `${Math.round(ratio * 100)}%`
}
