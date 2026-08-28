// tests/summary-plan.test.ts — Deciding what to summarize.
//
// Everything expensive about this feature is decided here, and none of it is
// visible: a wrong batch is a summary that quietly omits a stretch of the
// story, or a call fired every turn for prose already covered. Both look like
// nothing from the outside.
//
// The two rules this file exists to pin:
//
// 1. SUMMARIZE BEFORE THE PROSE FALLS OFF, not after. Coverage runs a quantum
//    ahead of the window's edge, so there is never a turn where a passage is
//    neither visible nor summarized. Waiting until after would open that blind
//    spot every time the edge jumped.
//
// 2. NEVER WALK BACKWARD. Switching a long story on, or shrinking its window,
//    leaves prose that fell out uncovered — and it STAYS uncovered. The
//    alternative is dozens of sequential calls firing unbidden, which is the
//    behaviour this deliberately does not have.

import { describe, expect, test } from "bun:test"

import { composeContext, manuscriptWithOffsets } from "@/lib/generation/context"
import { planSummary, summaryWordTarget } from "@/lib/generation/summary-plan"
import {
  renderSummaryRequest,
  renderSummarySystemPrompt,
} from "@/lib/generation/summary-prompt"
import type { Story, StoryEntry } from "@/lib/types"

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

/** Paragraphs that name themselves, so a batch can be identified by content. */
function prose(count: number, chars = 400): StoryEntry[] {
  return Array.from({ length: count }, (_, index) =>
    entry(`Passage ${index}. ${"word ".repeat(Math.floor(chars / 5))}`.trim())
  )
}

function story(entries: StoryEntry[], contextWindow = 8192): Story {
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
    tintAuto: true,
    entries,
    images: [],
    profileId: null,
    settings: {
      modelId: "test/model",
      thinking: "off",
      providerTag: null,
      zdr: false,
      temperature: 0.9,
      topP: 0.95,
      contextWindow,
      loreBudget: 25,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
    imageModelId: null,
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
  }
}

function trimOf(entries: StoryEntry[], contextWindow = 8192) {
  return composeContext({
    story: story(entries, contextWindow),
    lorebookEntries: [],
  }).trim
}

describe("planSummary — when it does nothing", () => {
  test("a story that still fits its window is never summarized", () => {
    const entries = prose(3)
    const trim = trimOf(entries)
    expect(trim.windowStart).toBe(0)
    expect(planSummary({ entries, trim, recap: null })).toBeNull()
  })

  test("a story with no passages at all", () => {
    expect(
      planSummary({
        entries: [],
        trim: { windowStart: 0, quantum: 2048 },
        recap: null,
      })
    ).toBeNull()
  })

  test("coverage already a quantum ahead of the edge", () => {
    const entries = prose(200)
    const trim = trimOf(entries)
    const { ends } = manuscriptWithOffsets(entries)
    const target = trim.windowStart + trim.quantum
    const ahead = ends.findIndex((end) => end >= target)
    expect(ahead).toBeGreaterThan(-1)
    expect(
      planSummary({
        entries,
        trim,
        recap: { throughEntryId: entries[ahead]!.id },
      })
    ).toBeNull()
  })
})

describe("planSummary — the batch about to fall off", () => {
  test("covers past the window's edge, so the recap is ready before it is needed", () => {
    const entries = prose(200)
    const trim = trimOf(entries)
    const plan = planSummary({ entries, trim, recap: null })
    expect(plan).not.toBeNull()
    const { ends } = manuscriptWithOffsets(entries)
    const throughIndex = entries.findIndex((e) => e.id === plan!.throughEntryId)
    // The whole point: coverage reaches past where the window currently starts.
    expect(ends[throughIndex]!).toBeGreaterThan(trim.windowStart)
  })

  test("picks up exactly where the previous version left off", () => {
    const entries = prose(200)
    const trim = trimOf(entries)
    const { ends } = manuscriptWithOffsets(entries)
    // A version covering just past the edge — the ordinary steady state.
    const covered = ends.findIndex((end) => end > trim.windowStart)
    const plan = planSummary({
      entries,
      trim,
      recap: { throughEntryId: entries[covered]!.id },
    })
    expect(plan).not.toBeNull()
    // Nothing already covered is folded in twice...
    expect(plan!.newProse).not.toContain(`Passage ${covered}.`)
    // ...and the passage right after it is.
    expect(plan!.newProse).toContain(`Passage ${covered + 1}.`)
  })

  test("a batch always begins at a passage boundary", () => {
    const entries = prose(200)
    const trim = trimOf(entries)
    const plan = planSummary({ entries, trim, recap: null })
    expect(plan!.newProse).toMatch(/^Passage \d+\./)
  })

  test("a passage longer than a whole quantum still makes progress", () => {
    // One enormous paragraph overshoots the target on its own. Returning null
    // here would mean such a story is never summarized at all.
    const entries = [...prose(40), entry("Huge. " + "word ".repeat(3000))]
    const trim = trimOf(entries)
    const plan = planSummary({ entries, trim, recap: null })
    expect(plan).not.toBeNull()
  })
})

describe("planSummary — the gap is skipped, never walked", () => {
  test("a story switched on late starts at the window's edge, not at page one", () => {
    const entries = prose(200)
    const trim = trimOf(entries)
    const plan = planSummary({ entries, trim, recap: null })
    expect(plan).not.toBeNull()
    // Everything before the edge stays as forgotten as it already was. If this
    // ever starts including Passage 0, the backlog walk is back.
    expect(plan!.newProse).not.toContain("Passage 0.")
    expect(plan!.newProse).not.toContain("Passage 1.")
  })

  test("one call's worth of prose, not the whole manuscript", () => {
    const entries = prose(200)
    const trim = trimOf(entries)
    const plan = planSummary({ entries, trim, recap: null })
    // Roughly a quantum, plus at most the one passage that straddles the end.
    expect(plan!.newProse.length).toBeLessThan(trim.quantum + 1000)
  })

  test("a stale version far behind the edge does not drag the batch back", () => {
    const entries = prose(200)
    const trim = trimOf(entries)
    // Coverage from before the window shrank: way behind the current edge.
    const plan = planSummary({
      entries,
      trim,
      recap: { throughEntryId: entries[2]!.id },
    })
    expect(plan).not.toBeNull()
    expect(plan!.newProse).not.toContain("Passage 3.")
  })

  test("a version naming a passage that is gone is treated as no version", () => {
    const entries = prose(200)
    const trim = trimOf(entries)
    const plan = planSummary({
      entries,
      trim,
      recap: { throughEntryId: "entry-that-was-rewound-away" },
    })
    expect(plan).not.toBeNull()
    expect(plan!.newProse).not.toContain("Passage 0.")
  })
})

describe("summaryWordTarget", () => {
  test("scales with the window between its bounds", () => {
    expect(summaryWordTarget(8192)).toBe(307)
    expect(summaryWordTarget(16384)).toBe(600)
  })

  test("small windows still get a usable target", () => {
    expect(summaryWordTarget(2048)).toBe(150)
    expect(summaryWordTarget(512)).toBe(150)
  })

  test("large windows do not get an ever-longer recap", () => {
    expect(summaryWordTarget(131072)).toBe(600)
    expect(summaryWordTarget(1_000_000)).toBe(600)
  })
})

describe("what the summarizer is asked", () => {
  test("the word target reaches the model as a number, not a placeholder", () => {
    const system = renderSummarySystemPrompt(307)
    expect(system).toContain("roughly 307 words")
    expect(system).not.toContain("{target}")
  })

  test("memory is included so the recap can be told not to repeat it", () => {
    const user = renderSummaryRequest({
      previous: "You crossed the Graywater.",
      newProse: "Passage 41. You paid Marla.",
      memory: "Maren owes the river a map.",
      targetWords: 307,
    })
    expect(user).toContain("[Memory]\nMaren owes the river a map.")
    expect(user).toContain("[Summary so far]\nYou crossed the Graywater.")
    expect(user).toContain("[New passages]\nPassage 41. You paid Marla.")
  })

  test("a story with no memory sends no empty Memory block", () => {
    const user = renderSummaryRequest({
      previous: "",
      newProse: "Passage 41.",
      memory: "   ",
      targetWords: 150,
    })
    expect(user).not.toContain("[Memory]")
  })

  test("the first batch says so rather than sending an empty summary", () => {
    const user = renderSummaryRequest({
      previous: "",
      newProse: "Passage 41.",
      memory: "",
      targetWords: 150,
    })
    // An empty [Summary so far] block reads as a summary that says nothing,
    // which is a different instruction from "there is not one yet".
    expect(user).toContain("this is the first part of the story")
  })
})
