// tests/context-breakdown.test.ts — The specification for lib/generation/
// breakdown.ts and for the fit report composeContext now carries.
//
// The load-bearing property is the first suite: the sections must be a literal
// PARTITION of the prompt that was sent. Everything the viewer says rests on
// that — a breakdown whose spans do not concatenate back to the prompt is a
// picture of a request that never happened, and it would be indistinguishable
// on screen from a correct one. So it is asserted by reconstruction, against
// the same renderPrompt the provider is handed, rather than by checking that
// the numbers look plausible.

import { describe, expect, test } from "bun:test"

import {
  CONTEXT_SECTION_ORDER,
  describeContext,
  type ContextBreakdown,
} from "@/lib/generation/breakdown"
import {
  composeContext,
  estimateTokens,
  renderPrompt,
} from "@/lib/generation/context"
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/generation/system-prompt"
import type { LorebookEntry, Story, StoryEntry } from "@/lib/types"

// ---------------------------------------------------------------------------
// Fixtures

let seq = 0
function entry(text: string): StoryEntry {
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
  }
}

function lore(overrides: Partial<LorebookEntry> = {}): LorebookEntry {
  seq += 1
  return {
    id: `lore-${seq}`,
    storyId: "story-1",
    name: `Entry ${seq}`,
    category: "concept",
    keys: ["lighthouse"],
    content: "A lighthouse stands on the cape.",
    enabled: true,
    alwaysActive: false,
    priority: 50,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function story(overrides: Partial<Story> = {}): Story {
  return {
    id: "story-1",
    title: "Test",
    description: "",
    genre: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    wordCount: 0,
    entries: [],
    // Custom, i.e. following no profile — so `settings` below is the story's
    // own, which is what every case here is written against.
    profileId: null,
    settings: {
      modelId: "~test/model",
      thinking: "off",
      providerTag: null,
      zdr: false,
      temperature: 1,
      topP: 1,
      maxTokens: 512,
      contextWindow: 8192,
      loreBudget: 25,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
    memory: "",
    summarize: true,
    summary: "",
    authorsNote: "",
    systemPrompt: null,
    activeLorebookEntryIds: [],
    canUndo: false,
    canRedo: false,
    undoSummary: null,
    redoSummary: null,
    ...overrides,
  }
}

/** The spans in wire order, joined — which must BE the prompt. */
function reconstruct(breakdown: ContextBreakdown): string {
  return breakdown.spans.map((span) => span.text).join("")
}

// ---------------------------------------------------------------------------

describe("describeContext partitions the prompt", () => {
  const cases: Array<[string, Story, LorebookEntry[]]> = [
    ["a bare story", story(), []],
    [
      "every section populated",
      story({
        memory: "The lighthouse keeper never sleeps.",
        authorsNote: "Write in close third person.",
        systemPrompt: "You are a narrator.",
        entries: [entry("The lighthouse blinked."), entry("She waited.")],
      }),
      [lore()],
    ],
    [
      "one paragraph and no author's note",
      story({ entries: [entry("Only this.")] }),
      [],
    ],
    [
      "memory only, no prose",
      story({ memory: "It rains here always." }),
      [lore({ alwaysActive: true, keys: [] })],
    ],
  ]

  for (const [name, subject, lorebookEntries] of cases) {
    test(name, () => {
      const ctx = composeContext({ story: subject, lorebookEntries })
      const breakdown = describeContext(ctx, subject.settings.contextWindow)

      // The whole promise: nothing invented, nothing dropped, nothing double
      // counted — including every separator between blocks.
      expect(reconstruct(breakdown)).toBe(ctx.systemPrompt + renderPrompt(ctx))
      // …and the total the header shows is the one that was measured.
      expect(breakdown.usedTokens).toBe(ctx.approxTokens)
      expect(breakdown.usedTokens).toBe(estimateTokens(reconstruct(breakdown)))
      // Grouping loses nothing either: every span lands in exactly one section.
      expect(
        breakdown.sections.reduce((total, section) => total + section.chars, 0)
      ).toBe(reconstruct(breakdown).length)
    })
  }

  test("sections keep bar order and never repeat", () => {
    const subject = story({
      memory: "Remember this.",
      authorsNote: "Be brief.",
      entries: [entry("The lighthouse blinked."), entry("She waited.")],
    })
    const ctx = composeContext({ story: subject, lorebookEntries: [lore()] })
    const ids = describeContext(ctx, 8192).sections.map((s) => s.id)

    expect(ids).toEqual(["system", "memory", "lore", "story", "authorsNote"])
    expect(new Set(ids).size).toBe(ids.length)
    // Story prose is rendered as two blocks with the author's note between
    // them; the section must still be ONE band carrying both.
    expect(ids.filter((id) => id === "story")).toHaveLength(1)
  })

  test("a section nobody wrote is left out entirely", () => {
    const ctx = composeContext({ story: story(), lorebookEntries: [] })
    const ids = describeContext(ctx, 8192).sections.map((s) => s.id)

    expect(ids).toEqual(["system", "story"])
    expect(CONTEXT_SECTION_ORDER).toContain("memory")
  })
})

describe("fit reporting", () => {
  test("an untrimmed story reports the whole manuscript", () => {
    const subject = story({ entries: [entry("Short.")] })
    const ctx = composeContext({ story: subject, lorebookEntries: [] })
    const storySection = describeContext(ctx, 8192).sections.find(
      (s) => s.id === "story"
    )

    expect(ctx.fit.storyCharsKept).toBe(ctx.fit.storyChars)
    expect(storySection?.fit).toBe(1)
    expect(storySection?.fitNote).toBe("The whole manuscript fit.")
  })

  test("a trimmed story reports what survived", () => {
    // Twelve fat paragraphs against the smallest stop: prose is the last thing
    // budgeted, so most of this cannot fit.
    const entries = Array.from({ length: 12 }, (_, i) =>
      entry(`Paragraph ${i}. ${"word ".repeat(120)}`)
    )
    const ctx = composeContext({
      story: story({ entries }),
      lorebookEntries: [],
      contextWindow: 2048,
    })
    const storySection = describeContext(ctx, 2048).sections.find(
      (s) => s.id === "story"
    )

    expect(ctx.fit.storyCharsKept).toBeLessThan(ctx.fit.storyChars)
    expect(storySection?.fit).toBeLessThan(1)
    expect(storySection?.fitNote).toContain("of the manuscript fit")
    // The tail is what survives, so the last paragraph is still in there.
    expect(ctx.storyText).toContain("Paragraph 11.")
  })

  test("dropped lore is reported as dropped, not as absent", () => {
    const entries = [entry("The lighthouse blinked over the cape.")]
    // Each of these triggers; only the first few can fit a 2k window's lore
    // share, and the rest must be visible in the report as trimmed.
    const lorebookEntries = Array.from({ length: 8 }, (_, i) =>
      lore({
        name: `Lore ${i}`,
        content: "lighthouse ".repeat(80),
        priority: 100 - i,
      })
    )
    const ctx = composeContext({
      story: story({ entries }),
      lorebookEntries,
      contextWindow: 2048,
    })
    const loreSection = describeContext(ctx, 2048).sections.find(
      (s) => s.id === "lore"
    )

    expect(ctx.fit.loreMatched).toBe(8)
    expect(ctx.lore.length).toBeLessThan(8)
    expect(loreSection?.fitNote).toContain("trimmed for space")
    // One row per entry that made it, so the list can name them.
    expect(loreSection?.items).toHaveLength(ctx.lore.length)
    expect(loreSection?.items[0]?.matchedKey).toBe("lighthouse")
  })

  test("lore trimmed away ENTIRELY is still reported, not omitted", () => {
    // The worst case, and the one the empty-section skip used to swallow: a
    // section with no text left is indistinguishable on screen from a lorebook
    // that never triggered, and only one of those is the writer's problem.
    const ctx = composeContext({
      story: story({
        entries: [entry("The lighthouse blinked over the cape.")],
      }),
      lorebookEntries: [lore({ content: "lighthouse ".repeat(500) })],
      contextWindow: 2048,
    })
    const loreSection = describeContext(ctx, 2048).sections.find(
      (s) => s.id === "lore"
    )

    expect(ctx.fit.loreMatched).toBe(1)
    expect(ctx.lore).toHaveLength(0)
    expect(loreSection).toBeDefined()
    expect(loreSection?.fit).toBe(0)
    expect(loreSection?.fitNote).toBe(
      "0 of 1 triggered entry fit — 1 was trimmed for space."
    )
  })

  test("all triggered lore fitting says so", () => {
    const ctx = composeContext({
      story: story({ entries: [entry("The lighthouse blinked.")] }),
      lorebookEntries: [lore()],
    })
    const loreSection = describeContext(ctx, 8192).sections.find(
      (s) => s.id === "lore"
    )

    expect(loreSection?.fit).toBe(1)
    expect(loreSection?.fitNote).toBe("All 1 triggered entry fit.")
  })

  test("a manuscript trimmed to nothing says so, and never reads 0%", () => {
    // Overhead alone eats the window, so no prose survives and the [Story]
    // block becomes the empty-story placeholder. "The last 0% fit" would
    // caption a body that flatly contradicts it, and would bury the part that
    // matters: the model is being told this manuscript is blank.
    const ctx = composeContext({
      story: story({
        memory: "remember ".repeat(1200),
        entries: [entry("The lighthouse blinked."), entry("She waited.")],
      }),
      lorebookEntries: [],
      contextWindow: 2048,
    })
    const storySection = describeContext(ctx, 2048).sections.find(
      (s) => s.id === "story"
    )

    expect(ctx.fit.storyChars).toBeGreaterThan(0)
    expect(ctx.fit.storyCharsKept).toBe(0)
    expect(storySection?.fitNote).toContain("None of the manuscript fit")
    expect(storySection?.fitNote).toContain("told the story is empty")
    expect(storySection?.fitNote).not.toContain("0%")
  })

  test("a share never rounds to a number the sentence contradicts", () => {
    // A manuscript a hair over the window must not read "100% fit ... were
    // trimmed".
    //
    // systemPrompt is pinned because this case has to land in the narrow band
    // where only a little is trimmed, and the prompt is fixed overhead
    // subtracted from the same budget. Left on the default, the row count is
    // really a measurement of how long that prompt happens to be, and rewording
    // it moves the whole manuscript inside the window — which is how this test
    // failed when the default was cut to a third of its size.
    //
    // The assertion is on the CONTRADICTION, not on an exact percentage: the
    // story window advances in whole quanta (see STORY_TRIM_QUANTUM), so how
    // much of a barely-over manuscript survives is a function of where the
    // anchor lands, and pinning "99%" would be pinning that arithmetic rather
    // than the property the sentence has to keep.
    const nearlyWhole = composeContext({
      story: story({
        systemPrompt: "System.",
        entries: Array.from({ length: 720 }, (_, i) =>
          entry(`Paragraph ${i} ${"x".repeat(30)}`)
        ),
      }),
      lorebookEntries: [],
    })
    const nearlyWholeNote = describeContext(nearlyWhole, 8192).sections.find(
      (s) => s.id === "story"
    )?.fitNote

    expect(nearlyWhole.fit.storyCharsKept).toBeLessThan(
      nearlyWhole.fit.storyChars
    )
    expect(nearlyWholeNote).toContain("were trimmed")
    expect(nearlyWholeNote).not.toContain("100%")
    // Still recognisably "nearly whole" — a note reading 40% here would mean
    // the fixture stopped testing the rounding band it was written for. The
    // bar sits at 0.75 rather than 0.95 because the window's leading edge is
    // quantized: up to an eighth of the budget is deliberately left unspent
    // between jumps (see trimQuantum), and that headroom comes out of exactly
    // this ratio.
    expect(
      nearlyWhole.fit.storyCharsKept / nearlyWhole.fit.storyChars
    ).toBeGreaterThan(0.75)

    // …and a sliver of a huge manuscript must not read "0% fit" while prose is
    // demonstrably in the window.
    const sliver = composeContext({
      story: story({
        entries: Array.from({ length: 12_000 }, (_, i) =>
          entry(`Paragraph ${i} ${"x".repeat(40)}`)
        ),
      }),
      lorebookEntries: [],
      contextWindow: 2048,
    })
    const sliverNote = describeContext(sliver, 2048).sections.find(
      (s) => s.id === "story"
    )?.fitNote

    expect(sliver.fit.storyCharsKept).toBeGreaterThan(0)
    expect(sliverNote).toContain("<1%")
  })

  test("untrimmable sections report no fraction", () => {
    const ctx = composeContext({
      story: story({ memory: "M", authorsNote: "A" }),
      lorebookEntries: [],
    })
    const sections = describeContext(ctx, 8192).sections

    for (const id of ["system", "memory", "authorsNote"] as const) {
      expect(sections.find((s) => s.id === id)?.fit).toBeNull()
    }
  })
})

describe("window arithmetic", () => {
  test("free tokens are what the window has left", () => {
    const ctx = composeContext({ story: story(), lorebookEntries: [] })
    const breakdown = describeContext(ctx, 8192)

    expect(breakdown.freeTokens).toBe(8192 - ctx.approxTokens)
    expect(breakdown.overflowing).toBe(false)
  })

  test("overhead that cannot be trimmed is reported as overflow", () => {
    // The default system prompt plus a long memory against the smallest stop:
    // none of it is trimmable, so composeContext legitimately overshoots and
    // the breakdown must say so rather than clamp it out of sight.
    const ctx = composeContext({
      story: story({ memory: "remember ".repeat(1200) }),
      lorebookEntries: [],
      contextWindow: 2048,
    })
    const breakdown = describeContext(ctx, 2048)

    expect(breakdown.usedTokens).toBeGreaterThan(2048)
    expect(breakdown.overflowing).toBe(true)
    expect(breakdown.freeTokens).toBe(0)
    // Still a faithful partition, even in the state the budget failed to reach.
    expect(reconstruct(breakdown)).toBe(ctx.systemPrompt + renderPrompt(ctx))
    expect(ctx.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT)
  })
})
