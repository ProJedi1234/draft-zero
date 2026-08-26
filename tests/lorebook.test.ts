// tests/lorebook.test.ts — The specification for lib/generation/lorebook.ts.
//
// The matcher had no direct test before this file: it was only exercised
// through the context-breakdown suite, always with a single-word key, so every
// rule below could have been changed without turning anything red. The first
// suite is therefore CHARACTERIZATION — it pins the behaviour that already
// shipped, including the substring false positive, which is documented here on
// purpose rather than quietly fixed. The suites after it are the new work:
// memory and the author's note as trigger sources, and cascading activation.

import { describe, expect, test } from "bun:test"

import {
  buildScanSources,
  matchActiveLorebookEntries,
  MAX_CASCADE_DEPTH,
  recentStoryText,
} from "@/lib/generation/lorebook"
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
    tintHue: null,
    tintStrength: 1,
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

/** Just the story window, as the pre-cascade signature took it. */
function storyOnly(entries: StoryEntry[]) {
  return buildScanSources(story({ entries }))
}

function names(matches: { entry: LorebookEntry }[]): string[] {
  return matches.map((match) => match.entry.name)
}

// ---------------------------------------------------------------------------
// 1. Characterization — the scan window

describe("recentStoryText", () => {
  test("joins the last four entries with a blank line, lowercased", () => {
    const text = recentStoryText([entry("Alpha"), entry("BETA")])
    expect(text).toBe("alpha\n\nbeta")
  })

  test("looks no further back than four entries", () => {
    const text = recentStoryText([
      entry("oldest"),
      entry("b"),
      entry("c"),
      entry("d"),
      entry("newest"),
    ])
    expect(text).not.toContain("oldest")
    expect(text).toContain("newest")
  })

  test("keeps the TAIL when the window is over the character cap", () => {
    // The most recent prose is what the model continues from, so it is the
    // last thing given up — the cut takes the head off, not the tail.
    const text = recentStoryText([entry("x".repeat(4100) + "needle")])
    expect(text.length).toBe(4000)
    expect(text).toContain("needle")
  })

  test("is empty for a story with no prose", () => {
    expect(recentStoryText([])).toBe("")
  })
})

// ---------------------------------------------------------------------------
// 2. Characterization — activation

describe("matchActiveLorebookEntries: activation", () => {
  test("a key seen in recent prose activates its entry", () => {
    const matched = lore({ name: "Lighthouse", keys: ["lighthouse"] })
    const result = matchActiveLorebookEntries(
      [matched],
      storyOnly([entry("The lighthouse burned all night.")])
    )
    expect(names(result)).toEqual(["Lighthouse"])
    expect(result[0]?.matchedKey).toBe("lighthouse")
  })

  test("matching is case-insensitive in both directions", () => {
    const result = matchActiveLorebookEntries(
      [lore({ keys: ["LIGHTHOUSE"] })],
      storyOnly([entry("the Lighthouse")])
    )
    expect(result).toHaveLength(1)
  })

  test("a key nobody wrote does not activate", () => {
    const result = matchActiveLorebookEntries(
      [lore({ keys: ["kraken"] })],
      storyOnly([entry("The lighthouse burned.")])
    )
    expect(result).toEqual([])
  })

  test("a disabled entry never activates, even when always-active", () => {
    const result = matchActiveLorebookEntries(
      [lore({ enabled: false, alwaysActive: true, keys: ["lighthouse"] })],
      storyOnly([entry("The lighthouse burned.")])
    )
    expect(result).toEqual([])
  })

  test("an always-active entry activates with no key in sight", () => {
    const result = matchActiveLorebookEntries(
      [lore({ name: "World", alwaysActive: true, keys: [] })],
      storyOnly([entry("Nothing relevant here.")])
    )
    expect(names(result)).toEqual(["World"])
    expect(result[0]?.matchedKey).toBeNull()
  })

  test("an always-active entry still reports a key that did match", () => {
    const result = matchActiveLorebookEntries(
      [lore({ alwaysActive: true, keys: ["lighthouse"] })],
      storyOnly([entry("The lighthouse burned.")])
    )
    expect(result[0]?.matchedKey).toBe("lighthouse")
  })

  test("the FIRST key in array order wins", () => {
    const result = matchActiveLorebookEntries(
      [lore({ keys: ["cape", "lighthouse"] })],
      storyOnly([entry("The lighthouse on the cape.")])
    )
    expect(result[0]?.matchedKey).toBe("cape")
  })

  test("keys are trimmed, and blank keys are skipped", () => {
    const result = matchActiveLorebookEntries(
      [lore({ keys: ["  ", "", "  lighthouse  "] })],
      storyOnly([entry("The lighthouse burned.")])
    )
    expect(result[0]?.matchedKey).toBe("  lighthouse  ")
  })

  test("matching is by SUBSTRING, not by word — documented, not endorsed", () => {
    // "Ann" matches "cannon". This is the behaviour that shipped; word-boundary
    // matching is a deliberate backlog item, and this test is what will have to
    // be rewritten (visibly) on the day it lands.
    const result = matchActiveLorebookEntries(
      [lore({ keys: ["Ann"] })],
      storyOnly([entry("He loaded the cannon.")])
    )
    expect(result).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 3. Characterization — ordering

describe("matchActiveLorebookEntries: ordering", () => {
  test("higher priority comes first, ties broken by id", () => {
    const low = lore({ id: "lore-a", name: "Low", priority: 10 })
    const high = lore({ id: "lore-b", name: "High", priority: 90 })
    const tieA = lore({ id: "lore-c", name: "TieA", priority: 50 })
    const tieB = lore({ id: "lore-d", name: "TieB", priority: 50 })
    const result = matchActiveLorebookEntries(
      [tieB, low, tieA, high],
      storyOnly([entry("The lighthouse burned.")])
    )
    expect(names(result)).toEqual(["High", "TieA", "TieB", "Low"])
  })
})

// ---------------------------------------------------------------------------
// 4. New — memory and the author's note as trigger sources

describe("scan sources beyond the story", () => {
  test("a name that appears only in memory activates its entry", () => {
    const sources = buildScanSources(
      story({
        entries: [entry("Rain on the roof.")],
        memory: "Mira is the harbourmaster.",
      })
    )
    const result = matchActiveLorebookEntries(
      [lore({ name: "Mira", keys: ["Mira"] })],
      sources
    )
    expect(names(result)).toEqual(["Mira"])
    expect(result[0]?.triggeredBy).toEqual({ kind: "source", source: "memory" })
  })

  test("a name that appears only in the author's note activates its entry", () => {
    const sources = buildScanSources(
      story({
        entries: [entry("Rain on the roof.")],
        authorsNote: "Keep the tone close to Mira's grief.",
      })
    )
    const result = matchActiveLorebookEntries(
      [lore({ name: "Mira", keys: ["Mira"] })],
      sources
    )
    expect(result[0]?.triggeredBy).toEqual({
      kind: "source",
      source: "authorsNote",
    })
  })

  test("a story-window match is attributed to the story", () => {
    const result = matchActiveLorebookEntries(
      [lore({ keys: ["lighthouse"] })],
      storyOnly([entry("The lighthouse burned.")])
    )
    expect(result[0]?.triggeredBy).toEqual({ kind: "source", source: "story" })
  })

  test("memory wins attribution over the story when both mention the key", () => {
    // Not arbitrary: an entry memory keeps alive cannot fall out of context
    // when the prose scrolls, and that is what makes it cacheable-stable.
    const sources = buildScanSources(
      story({
        entries: [entry("The lighthouse burned.")],
        memory: "The lighthouse guards the cape.",
      })
    )
    const result = matchActiveLorebookEntries(
      [lore({ keys: ["lighthouse"] })],
      sources
    )
    expect(result[0]?.triggeredBy).toEqual({ kind: "source", source: "memory" })
    expect(result[0]?.stable).toBe(true)
  })

  test("the story window is volatile; memory and always-on are stable", () => {
    const sources = buildScanSources(
      story({
        entries: [entry("The lighthouse burned.")],
        memory: "Mira is the harbourmaster.",
      })
    )
    const result = matchActiveLorebookEntries(
      [
        lore({ name: "Lighthouse", keys: ["lighthouse"] }),
        lore({ name: "Mira", keys: ["Mira"] }),
        lore({ name: "World", alwaysActive: true, keys: [] }),
      ],
      sources
    )
    const byName = new Map(result.map((m) => [m.entry.name, m.stable]))
    expect(byName.get("Lighthouse")).toBe(false)
    expect(byName.get("Mira")).toBe(true)
    expect(byName.get("World")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. New — cascading activation

describe("cascading activation", () => {
  test("an active entry's text triggers a second entry", () => {
    const first = lore({
      id: "lore-a",
      name: "Elvenhome",
      keys: ["elvenhome"],
      content: "The elves fled to Elvenhome after the Sundering.",
    })
    const second = lore({
      id: "lore-b",
      name: "Sundering",
      keys: ["Sundering"],
      content: "The Sundering split the continent.",
    })
    const result = matchActiveLorebookEntries(
      [first, second],
      storyOnly([entry("They rode for Elvenhome.")])
    )
    expect(names(result).sort()).toEqual(["Elvenhome", "Sundering"])
    const cascaded = result.find((m) => m.entry.name === "Sundering")
    expect(cascaded?.depth).toBe(1)
    expect(cascaded?.triggeredBy).toEqual({
      kind: "lore",
      id: "lore-a",
      name: "Elvenhome",
    })
  })

  test("a directly matched entry is depth 0", () => {
    const result = matchActiveLorebookEntries(
      [lore({ keys: ["lighthouse"] })],
      storyOnly([entry("The lighthouse burned.")])
    )
    expect(result[0]?.depth).toBe(0)
  })

  test("an always-active entry seeds the cascade", () => {
    const seed = lore({
      id: "lore-a",
      name: "World",
      alwaysActive: true,
      keys: [],
      content: "The realm of Elvenhome endures.",
    })
    const reached = lore({
      id: "lore-b",
      name: "Elvenhome",
      keys: ["Elvenhome"],
    })
    const result = matchActiveLorebookEntries([seed, reached], storyOnly([]))
    expect(names(result).sort()).toEqual(["Elvenhome", "World"])
  })

  test("a cascade seeded by memory stays stable; one seeded by prose does not", () => {
    const fromMemory = lore({
      id: "lore-a",
      name: "Mira",
      keys: ["Mira"],
      content: "Mira keeps the Tidebell.",
    })
    const reached = lore({ id: "lore-b", name: "Tidebell", keys: ["Tidebell"] })
    const stable = matchActiveLorebookEntries(
      [fromMemory, reached],
      buildScanSources(story({ memory: "Mira is the harbourmaster." }))
    )
    expect(stable.find((m) => m.entry.name === "Tidebell")?.stable).toBe(true)

    const volatile = matchActiveLorebookEntries(
      [fromMemory, reached],
      storyOnly([entry("Mira climbed the stair.")])
    )
    expect(volatile.find((m) => m.entry.name === "Tidebell")?.stable).toBe(
      false
    )
  })

  test("the cascade stops at the depth cap", () => {
    // Alpha → Bravo → Charlie → Delta → Echo, one link per round. With a cap of
    // 3 the chain reaches depth 3 and no further, so Echo must be absent.
    // Distinctive multi-letter names on purpose: single letters would match as
    // substrings of the link text itself (the "e" in "leads"), which is the
    // documented matcher behaviour and would make this test about the wrong
    // thing.
    const links = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"]
    const chain = links.map((name, index) =>
      lore({
        id: `lore-${name}`,
        name,
        keys: [name],
        content: links[index + 1] ? `leads to ${links[index + 1]}` : "the end",
      })
    )
    const result = matchActiveLorebookEntries(
      chain,
      storyOnly([entry("They spoke of Alpha.")])
    )
    const reached = names(result).sort()
    expect(reached).toEqual(["Alpha", "Bravo", "Charlie", "Delta"])
    expect(MAX_CASCADE_DEPTH).toBe(3)
  })

  test("a cycle terminates instead of hanging", () => {
    const a = lore({
      id: "lore-a",
      name: "Alpha",
      keys: ["Alpha"],
      content: "see Bravo",
    })
    const b = lore({
      id: "lore-b",
      name: "Bravo",
      keys: ["Bravo"],
      content: "see Alpha",
    })
    const result = matchActiveLorebookEntries(
      [a, b],
      storyOnly([entry("They spoke of Alpha.")])
    )
    expect(names(result).sort()).toEqual(["Alpha", "Bravo"])
    // Each entry appears exactly once, however many ways it was reached.
    expect(result).toHaveLength(2)
  })

  test("a disabled entry is never reached by cascade", () => {
    const first = lore({
      id: "lore-a",
      name: "Elvenhome",
      keys: ["elvenhome"],
      content: "The elves fled after the Sundering.",
    })
    const off = lore({
      id: "lore-b",
      name: "Sundering",
      keys: ["Sundering"],
      enabled: false,
    })
    const result = matchActiveLorebookEntries(
      [first, off],
      storyOnly([entry("They rode for Elvenhome.")])
    )
    expect(names(result)).toEqual(["Elvenhome"])
  })

  test("ordering is priority first, then depth, then id", () => {
    // Same priority: the entry the prose actually named outranks the one that
    // arrived by association, so trimming gives up the association first.
    const direct = lore({
      id: "lore-b",
      name: "Direct",
      keys: ["lighthouse"],
      content: "Mentions Cascaded.",
      priority: 50,
    })
    const cascaded = lore({
      id: "lore-a",
      name: "Cascaded",
      keys: ["Cascaded"],
      priority: 50,
    })
    const louder = lore({
      id: "lore-c",
      name: "Louder",
      keys: ["lighthouse"],
      priority: 90,
    })
    const result = matchActiveLorebookEntries(
      [cascaded, direct, louder],
      storyOnly([entry("The lighthouse burned.")])
    )
    expect(names(result)).toEqual(["Louder", "Direct", "Cascaded"])
  })

  test("an entry reachable two ways keeps its shallowest arrival", () => {
    const direct = lore({ id: "lore-a", name: "Direct", keys: ["lighthouse"] })
    const alsoMentions = lore({
      id: "lore-b",
      name: "Mentions",
      keys: ["lighthouse"],
      content: "Speaks of the Direct.",
    })
    const result = matchActiveLorebookEntries(
      [direct, alsoMentions],
      storyOnly([entry("The lighthouse burned.")])
    )
    expect(result.find((m) => m.entry.name === "Direct")?.depth).toBe(0)
  })
})
