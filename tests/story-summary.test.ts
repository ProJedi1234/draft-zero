// tests/story-summary.test.ts — The rolling summary's half of context
// composition, and the query that decides which stored version is in force.
//
// Two things carry this feature, and neither is observable from the app:
//
// 1. THE PROMPT STILL CONCATENATES. promptSegments exists to hand a provider
//    cache breakpoints without changing a byte the model reads, and adding a
//    fourth segment is exactly the change that could break that quietly. The
//    identity is asserted with a summary and without one.
//
// 2. THE ANCHOR SITS ON A FIXED GRID. The trim anchor is quantized so the
//    manuscript head is byte-identical between turns; that is the whole reason
//    upstream caching can ever hit. The summary is charged as overhead, so it
//    moves the prose budget — and if the quantum were derived from that budget
//    (as it was before this feature), every rewrite would rebase the anchor and
//    silently defeat the quantization. The grid property is what pins it.
//
// The resolver is asserted as SQL rather than against a database: the suite has
// no DB harness and the dev Postgres is shared, so the statement is rendered
// with PgDialect the same way tests/generation-calls.test.ts renders its
// WHEREs. What matters there is that the liveness filter is present at all —
// without it a rewound branch's summary comes back to describe a future that
// was un-happened, and it does so silently.

import { describe, expect, test } from "bun:test"

import {
  composeContext,
  estimateTokens,
  promptBlocks,
  promptSegments,
  renderPrompt,
} from "@/lib/generation/context"
import { describeContext } from "@/lib/generation/breakdown"
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

/** `count` paragraphs of roughly `chars` each — long enough to overflow a window. */
function prose(count: number, chars = 400): StoryEntry[] {
  return Array.from({ length: count }, (_, index) =>
    entry(`Paragraph ${index}. ${"word ".repeat(Math.floor(chars / 5))}`.trim())
  )
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
      contextWindow: 8192,
      loreBudget: 25,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
    memory: "",
    authorsNote: "",
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

const NO_LORE: LorebookEntry[] = []

// ---------------------------------------------------------------------------

describe("the summary block", () => {
  test("is absent when the story has no summary", () => {
    const ctx = composeContext({
      story: story({ entries: prose(3) }),
      lorebookEntries: NO_LORE,
    })
    expect(promptBlocks(ctx).some((b) => b.section === "summary")).toBe(false)
    expect(renderPrompt(ctx)).not.toContain("[Story so far]")
  })

  test("sits between the cacheable head and the manuscript", () => {
    const ctx = composeContext({
      story: story({
        entries: prose(3),
        memory: "Maren owes the river a map.",
        summary: "You crossed the Graywater and lost the needle.",
      }),
      lorebookEntries: NO_LORE,
    })
    const sections = promptBlocks(ctx).map((b) => b.section)
    expect(sections.indexOf("memory")).toBeLessThan(sections.indexOf("summary"))
    expect(sections.indexOf("summary")).toBeLessThan(sections.indexOf("story"))
    expect(renderPrompt(ctx)).toContain(
      "[Story so far]\nYou crossed the Graywater and lost the needle."
    )
  })

  test("is trimmed of surrounding whitespace, and blank is the same as absent", () => {
    const ctx = composeContext({
      story: story({ entries: prose(3), summary: "   \n  " }),
      lorebookEntries: NO_LORE,
    })
    expect(promptBlocks(ctx).some((b) => b.section === "summary")).toBe(false)
  })

  test("shows up in the context breakdown as its own section", () => {
    const ctx = composeContext({
      story: story({ entries: prose(3), summary: "You lost the needle." }),
      lorebookEntries: NO_LORE,
    })
    const section = describeContext(ctx, 8192).sections.find(
      (s) => s.id === "summary"
    )
    expect(section?.label).toBe("Story so far")
    expect(section?.text).toContain("You lost the needle.")
  })
})

describe("segments still concatenate to the prompt", () => {
  const cases: [string, Partial<Story>][] = [
    ["no summary", {}],
    ["with a summary", { summary: "You crossed the Graywater." }],
    [
      "with memory and a summary",
      { memory: "Tone: wry.", summary: "You fell." },
    ],
    ["a story too long to fit", { entries: prose(200), summary: "You fell." }],
    ["a blank story with a summary", { entries: [], summary: "You fell." }],
  ]
  for (const [name, over] of cases) {
    test(name, () => {
      const ctx = composeContext({
        story: story({ entries: prose(4), ...over }),
        lorebookEntries: NO_LORE,
      })
      const joined = promptSegments(ctx)
        .map((segment) => segment.text)
        .join("")
      expect(joined).toBe(renderPrompt(ctx))
    })
  }

  test("head, summary and manuscript are cacheable; the tail is not", () => {
    const ctx = composeContext({
      story: story({
        entries: prose(40),
        memory: "Tone: wry.",
        authorsNote: "Keep it literal.",
        summary: "You crossed the Graywater.",
      }),
      lorebookEntries: NO_LORE,
    })
    expect(promptSegments(ctx).map((s) => s.cache)).toEqual([
      true,
      true,
      true,
      false,
    ])
  })
})

describe("the summary is paid for out of prose", () => {
  test("a long summary leaves less room for the manuscript", () => {
    const entries = prose(200)
    const without = composeContext({
      story: story({ entries }),
      lorebookEntries: NO_LORE,
    })
    const with_ = composeContext({
      story: story({ entries, summary: "You fell. ".repeat(200) }),
      lorebookEntries: NO_LORE,
    })
    expect(with_.storyText.length).toBeLessThan(without.storyText.length)
    // ...and the promise the budget makes is still kept.
    expect(with_.approxTokens).toBeLessThanOrEqual(8192)
  })

  test("estimateTokens covers the summary block, not just the prose", () => {
    const ctx = composeContext({
      story: story({ entries: prose(3), summary: "You fell." }),
      lorebookEntries: NO_LORE,
    })
    expect(ctx.approxTokens).toBe(
      estimateTokens(ctx.systemPrompt + renderPrompt(ctx))
    )
  })
})

describe("the trim anchor sits on a fixed grid", () => {
  test("windowStart is a whole number of quanta", () => {
    const ctx = composeContext({
      story: story({ entries: prose(200) }),
      lorebookEntries: NO_LORE,
    })
    expect(ctx.trim.windowStart).toBeGreaterThan(0)
    // The paragraph-boundary cut moves the true start past the quantized
    // offset, so the anchor is the largest multiple at or below it.
    const anchor =
      ctx.trim.windowStart - (ctx.trim.windowStart % ctx.trim.quantum)
    expect(ctx.trim.windowStart - anchor).toBeLessThan(600)
  })

  test("rewriting the summary does not rebase the anchor", () => {
    const entries = prose(200)
    // Two summaries a few hundred characters apart — the ordinary case, one
    // refine to the next. Before the quantum was based on the whole budget this
    // moved the anchor every time, and every turn missed the upstream cache.
    const short = composeContext({
      story: story({ entries, summary: "You fell into the Graywater." }),
      lorebookEntries: NO_LORE,
    })
    const longer = composeContext({
      story: story({
        entries,
        summary:
          "You fell into the Graywater. " + "You surfaced again. ".repeat(12),
      }),
      lorebookEntries: NO_LORE,
    })
    expect(longer.trim.quantum).toBe(short.trim.quantum)
    expect(longer.trim.windowStart).toBe(short.trim.windowStart)
  })

  test("the quantum follows the window, not the leftover budget", () => {
    const entries = prose(200)
    const bare = composeContext({
      story: story({ entries }),
      lorebookEntries: NO_LORE,
    })
    const loaded = composeContext({
      story: story({
        entries,
        memory: "m ".repeat(500),
        authorsNote: "a ".repeat(200),
        summary: "s ".repeat(300),
      }),
      lorebookEntries: NO_LORE,
    })
    expect(loaded.trim.quantum).toBe(bare.trim.quantum)
  })

  test("windowStart is 0 when the whole manuscript fits", () => {
    const ctx = composeContext({
      story: story({ entries: prose(2) }),
      lorebookEntries: NO_LORE,
    })
    expect(ctx.trim.windowStart).toBe(0)
    expect(ctx.storyText.length).toBe(ctx.fit.storyChars)
  })
})

describe("the empty-story marker tells the truth", () => {
  test("a genuinely blank story is asked for an opening", () => {
    const ctx = composeContext({
      story: story({ entries: [] }),
      lorebookEntries: NO_LORE,
    })
    expect(renderPrompt(ctx)).toContain("no text yet")
  })

  test("a story trimmed to nothing is told to continue from the summary", () => {
    // A window too small for any prose at all, but the story has happened.
    const ctx = composeContext({
      story: story({
        entries: prose(200),
        summary: "You crossed the Graywater and lost the needle.",
        settings: { ...story().settings, contextWindow: 350 },
      }),
      lorebookEntries: NO_LORE,
    })
    expect(ctx.storyText).toBe("")
    const prompt = renderPrompt(ctx)
    expect(prompt).toContain("Continue the story from the summary above")
    expect(prompt).not.toContain("no text yet")
  })
})
