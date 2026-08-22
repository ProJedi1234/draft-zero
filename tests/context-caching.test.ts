// tests/context-caching.test.ts — Prefix stability, asserted offline.
//
// A cache hit cannot be tested here: it is provider-side state, and finding out
// costs money. Its CAUSE can be. Prompt caching is a prefix match, so what
// decides whether an upstream cache can be read on turn N is exactly how many
// leading bytes of turn N's prompt are identical to turn N-1's. That is a pure
// function of composeContext, and this file measures it.
//
// So these are not tests about caching in the sense of mocking a provider.
// They are tests about the property the caching rests on, which is the half we
// can actually be sure of. The live half — that OpenRouter forwards our
// breakpoints and the provider honours them — is scripts/cache-probe.ts, run by
// hand against a real key.

import { describe, expect, test } from "bun:test"

import {
  composeContext,
  promptSegments,
  renderPrompt,
} from "@/lib/generation/context"
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

/** Length of the longest common leading run of two strings. */
function commonPrefix(a: string, b: string): number {
  const limit = Math.min(a.length, b.length)
  let i = 0
  while (i < limit && a[i] === b[i]) i += 1
  return i
}

/**
 * A writing session: `turns` successive generations, each composed from one
 * more passage than the last. Half the passages name the lighthouse and half do
 * not, so a story-triggered lore entry drifts in and out of the scan window —
 * the churn a real lorebook produces, rather than a stationary fixture that
 * would make any layout look stable.
 */
function session(options: {
  turns: number
  lorebookEntries: LorebookEntry[]
  memory?: string
  paragraph?: (index: number) => string
}): string[] {
  const {
    turns,
    lorebookEntries,
    memory = "",
    paragraph = (i: number) =>
      i % 2 === 0
        ? `Passage ${i}: the lighthouse turned in the dark. ${"word ".repeat(40)}`
        : `Passage ${i}: they walked inland and said nothing. ${"word ".repeat(40)}`,
  } = options

  const prompts: string[] = []
  const entries: StoryEntry[] = []
  for (let i = 0; i < turns; i += 1) {
    entries.push(entry(paragraph(i)))
    const context = composeContext({
      story: story({ entries: [...entries], memory }),
      lorebookEntries,
    })
    prompts.push(context.systemPrompt + renderPrompt(context))
  }
  return prompts
}

/** Mean shared-prefix fraction across consecutive turns. */
function meanPrefixRatio(prompts: string[]): number {
  let total = 0
  for (let i = 1; i < prompts.length; i += 1) {
    const shared = commonPrefix(prompts[i - 1]!, prompts[i]!)
    total += shared / Math.max(prompts[i]!.length, 1)
  }
  return total / Math.max(prompts.length - 1, 1)
}

// ---------------------------------------------------------------------------

describe("prefix stability across a writing session", () => {
  test("memory-triggered lore holds its place while story lore churns", () => {
    // The entry keyed on "Mira" is named only in memory, so it is stable and
    // sits in the head; the lighthouse entry drifts in and out of the story
    // window. If the stable entry were sorted in beside the volatile one, its
    // block would move every time the volatile one appeared or vanished, and
    // everything after it would stop matching.
    const prompts = session({
      turns: 12,
      memory: "Mira is the harbourmaster. The coast is unforgiving.",
      lorebookEntries: [
        lore({
          name: "Mira",
          keys: ["Mira"],
          priority: 60,
          content: "Mira keeps the harbour ledger.",
        }),
        lore({ name: "Lighthouse", keys: ["lighthouse"], priority: 40 }),
      ],
    })

    // Every turn shares at least the system prompt, memory and the stable lore
    // block with the turn before it — nothing in that head depends on the prose.
    const ratio = meanPrefixRatio(prompts)
    expect(ratio).toBeGreaterThan(0.5)
  })

  test("the manuscript head is byte-identical between quantum jumps", () => {
    // The point of quantized trimming: once the window is full, consecutive
    // turns must still share their whole story head, not lose a paragraph off
    // the front every single turn.
    const prompts = session({
      turns: 10,
      lorebookEntries: [],
      // Long passages, small window: this session overflows early and stays
      // overflowing, which is exactly where exact trimming used to churn.
      paragraph: (i) => `Passage ${i}. ${"filler ".repeat(120)}`,
    })

    const overflowing = prompts.slice(3)
    const identicalHeads = overflowing
      .slice(1)
      .filter(
        (prompt, index) =>
          commonPrefix(overflowing[index]!, prompt) > prompt.length * 0.5
      )
    // Most consecutive pairs share more than half their bytes. With exact
    // trimming the shared prefix collapses to the system prompt alone.
    expect(identicalHeads.length).toBeGreaterThan(overflowing.length / 2)
  })

  test("a story-triggered entry does not disturb the cacheable head", () => {
    // The head is memory + stable lore. Whether a volatile entry is in context
    // or not must not change a byte of it — that is what putting volatile lore
    // below the manuscript buys.
    // Mira's content deliberately does NOT mention the lighthouse: it would
    // cascade to the volatile entry and pull it into context on every turn,
    // which is correct behaviour and would quietly make this test vacuous.
    const lorebookEntries = [
      lore({
        name: "Mira",
        keys: ["Mira"],
        priority: 60,
        content: "Mira keeps the harbour ledger.",
      }),
      lore({ name: "Lighthouse", keys: ["lighthouse"], priority: 40 }),
    ]
    const memory = "Mira is the harbourmaster."

    const withVolatile = composeContext({
      story: story({
        memory,
        entries: [entry("The lighthouse turned in the dark.")],
      }),
      lorebookEntries,
    })
    const withoutVolatile = composeContext({
      story: story({
        memory,
        entries: [entry("They walked inland and said nothing.")],
      }),
      lorebookEntries,
    })

    // Sanity: the two really do differ in which lore is active.
    expect(withVolatile.lore).toHaveLength(2)
    expect(withoutVolatile.lore).toHaveLength(1)

    const head = (ctx: typeof withVolatile) => promptSegments(ctx)[0]?.text
    expect(head(withVolatile)).toBe(head(withoutVolatile)!)
  })
})

describe("promptSegments", () => {
  const context = () =>
    composeContext({
      story: story({
        memory: "Mira is the harbourmaster.",
        authorsNote: "Keep it cold.",
        entries: [
          entry("First passage about the lighthouse."),
          entry("Second passage."),
          entry("Third passage."),
        ],
      }),
      lorebookEntries: [
        lore({
          name: "Mira",
          keys: ["Mira"],
          content: "Mira keeps the harbour ledger.",
        }),
        lore({ name: "Lighthouse", keys: ["lighthouse"] }),
      ],
    })

  test("segments concatenate to exactly the rendered prompt", () => {
    // The load-bearing identity: splitting the turn into content parts must not
    // change a single byte of what the model reads.
    const ctx = context()
    const joined = promptSegments(ctx)
      .map((segment) => segment.text)
      .join("")
    expect(joined).toBe(renderPrompt(ctx))
  })

  test("the cacheable segments are the head and the manuscript, never the tail", () => {
    const segments = promptSegments(context())
    expect(segments).toHaveLength(3)
    expect(segments.map((segment) => segment.cache)).toEqual([
      true,
      true,
      false,
    ])
  })

  test("the head carries memory and stable lore; the tail carries the rest", () => {
    const segments = promptSegments(context())
    const [head, , tail] = segments
    expect(head!.text).toContain("[Memory]")
    expect(head!.text).toContain("[Lore: Mira]")
    expect(head!.text).not.toContain("[Lore: Lighthouse]")
    expect(tail!.text).toContain("[Lore: Lighthouse]")
    expect(tail!.text).toContain("[Author's note:")
  })

  test("an empty story still round-trips", () => {
    const ctx = composeContext({ story: story(), lorebookEntries: [] })
    const joined = promptSegments(ctx)
      .map((segment) => segment.text)
      .join("")
    expect(joined).toBe(renderPrompt(ctx))
  })
})
