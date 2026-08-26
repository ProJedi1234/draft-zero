// tests/context-window-equivalence.test.ts — A tail window composes the same
// prompt as the whole manuscript.
//
// getStory may hand composeContext only the tail of a story, plus two numbers
// describing what it dropped: entriesBefore (live entries) and charsBefore
// (manuscript chars, as manuscriptWithOffsets joins them, including the
// separator before the window's first entry). The claim these tests pin is
// exact, not approximate: for any split point whose tail still covers the
// trimmed window, every byte the model reads — and the seed, and the trim
// record the summarizer steers by — is identical to composing over the full
// entry list. If this drifts, it drifts silently: prompts still look right,
// caches quietly stop hitting, and the summarizer's coordinates shift.
//
// charsBefore is measured here the only honest way: by joining the dropped
// prefix with manuscriptWithOffsets itself. The SQL that computes it in
// production mirrors that arithmetic (UTF-16 lengths, "> " markers,
// separators) — which is why one fixture paragraph carries astral-plane
// characters: PostgreSQL counts codepoints, JS counts UTF-16 units, and only
// the JS number keeps these offsets honest.

import { describe, expect, test } from "bun:test"

import {
  composeContext,
  manuscriptWithOffsets,
  promptSegments,
  renderPrompt,
} from "@/lib/generation/context"
import type { LorebookEntry, Story, StoryEntry } from "@/lib/types"

// ---------------------------------------------------------------------------
// Fixtures

let seq = 0
function entry(text: string, over: Partial<StoryEntry> = {}): StoryEntry {
  seq += 1
  return {
    id: `entry-${seq}`,
    source: "generated",
    text,
    actionKind: null,
    inputText: null,
    variantGroupId: `group-${seq}`,
    variantIndex: 0,
    variantCount: 1,
    variantProfilesMixed: false,
    generation: null,
    costUsd: null,
    reasoningTokens: null,
    callStatus: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  }
}

/**
 * A manuscript long enough to overflow an 8192-char budget several times over,
 * with the shapes that cost characters in composition: player turns (the "> "
 * marker), multi-paragraph passages, and one passage of astral-plane emoji
 * (2 UTF-16 units each) to catch any codepoint-counted offset.
 */
function manuscript(count = 60): StoryEntry[] {
  return Array.from({ length: count }, (_, index) => {
    if (index % 7 === 3)
      return entry(`You say something measured, passage ${index}.`, {
        source: "user",
        actionKind: "say",
        inputText: `something measured, passage ${index}`,
      })
    if (index === 5)
      return entry(`The sky filled with lanterns ${"🙂🚀".repeat(40)}.`)
    if (index % 5 === 0)
      return entry(
        `Paragraph ${index} begins. ${"word ".repeat(60)}\n\nAnd continues. ${"word ".repeat(60)}`.trim()
      )
    return entry(`Passage ${index}. ${"word ".repeat(80)}`.trim())
  })
}

function story(over: Partial<Story> = {}): Story {
  return {
    id: "story-1",
    title: "A Story",
    description: "",
    genre: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    wordCount: 0,
    tintHue: null,
    tintStrength: 1,
    entries: [],
    profileId: null,
    settings: {
      modelId: "test/model",
      thinking: "off",
      providerTag: null,
      zdr: false,
      temperature: 0.9,
      topP: 0.95,
      maxTokens: 512,
      contextWindow: 2048,
      loreBudget: 25,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
    memory: "",
    authorsNote: "",
    summarize: true,
    summary: "",
    systemPrompt: null,
    activeLorebookEntryIds: [],
    canUndo: false,
    canRedo: false,
    undoSummary: null,
    redoSummary: null,
    ...over,
  }
}

/** The windowed twin of `full`: entries[splitAt..] plus the two offsets. */
function windowed(full: Story, splitAt: number): Story {
  const before = full.entries.slice(0, splitAt)
  const beforeText = manuscriptWithOffsets(before).text
  return {
    ...full,
    entries: full.entries.slice(splitAt),
    entriesBefore: splitAt,
    // The separator between the dropped prefix and the window's first entry
    // belongs to the prefix — the window's own text starts at its first entry.
    charsBefore: splitAt === 0 ? 0 : beforeText.length + "\n\n".length,
    hasMoreBefore: splitAt > 0,
  }
}

const NO_LORE: LorebookEntry[] = []

function compose(s: Story) {
  return composeContext({ story: s, lorebookEntries: NO_LORE })
}

// ---------------------------------------------------------------------------

describe("windowed composition equivalence", () => {
  const full = story({ entries: manuscript() })

  // Splits at an ordinary passage, right after the emoji passage, and right at
  // a player turn — the three places an off-by-marker or codepoint-counted
  // offset would land differently.
  for (const splitAt of [1, 6, 10, 17]) {
    test(`split at ${splitAt}: every byte, the seed, and the trim record match`, () => {
      const tail = windowed(full, splitAt)
      const wholeCtx = compose(full)
      const tailCtx = compose(tail)

      // Guard the guard: if the fixture ever shrinks below the budget the
      // identity holds trivially and stops testing the anchor arithmetic.
      expect(wholeCtx.trim.windowStart).toBeGreaterThan(0)

      expect(renderPrompt(tailCtx)).toBe(renderPrompt(wholeCtx))
      expect(promptSegments(tailCtx)).toEqual(promptSegments(wholeCtx))
      expect(tailCtx.seed).toBe(wholeCtx.seed)
      expect(tailCtx.approxTokens).toBe(wholeCtx.approxTokens)
      expect(tailCtx.trim).toEqual(wholeCtx.trim)
      expect(tailCtx.fit).toEqual(wholeCtx.fit)
    })
  }

  test("a summary shifts the budget identically on both sides", () => {
    const summarized = story({
      entries: manuscript(),
      summary:
        "Earlier, lanterns rose over the harbor and a bargain was struck.",
    })
    const wholeCtx = compose(summarized)
    const tailCtx = compose(windowed(summarized, 8))
    expect(renderPrompt(tailCtx)).toBe(renderPrompt(wholeCtx))
    expect(tailCtx.trim).toEqual(wholeCtx.trim)
  })

  test("a retry-filtered tail matches the same filter over the full list", () => {
    // startGeneration composes with the retried slot's entries removed; on a
    // windowed story that filter runs against the tail. Both sides drop the
    // final entry here, so the seed steps back by one in lockstep.
    const filteredFull = {
      ...full,
      entries: full.entries.slice(0, -1),
    }
    const filteredTail = { ...windowed(full, 10) }
    filteredTail.entries = filteredTail.entries.slice(0, -1)

    const wholeCtx = compose(filteredFull)
    const tailCtx = compose(filteredTail)
    expect(renderPrompt(tailCtx)).toBe(renderPrompt(wholeCtx))
    expect(tailCtx.seed).toBe(wholeCtx.seed)
    expect(tailCtx.trim).toEqual(wholeCtx.trim)
  })

  test("a tail smaller than the budget clamps to the whole tail", () => {
    // Only reachable when the inspector previews a window larger than the one
    // the tail was sized for: the composition may not be byte-identical to the
    // full one, but it must keep every entry it was given and stay coherent.
    const tail = windowed(full, 55)
    const ctx = composeContext({
      story: tail,
      lorebookEntries: NO_LORE,
      contextWindow: 32768,
    })
    const tailText = manuscriptWithOffsets(tail.entries).text
    expect(ctx.storyText).toBe(tailText)
    expect(ctx.trim.windowStart).toBe(tail.charsBefore ?? 0)
  })

  test("windowing an empty prefix is the identity", () => {
    const zero = windowed(full, 0)
    expect(zero.charsBefore).toBe(0)
    expect(renderPrompt(compose(zero))).toBe(renderPrompt(compose(full)))
  })
})
