// tests/brief-lore.test.ts — What a brief summons out of the lorebook.
//
// Worth its own file because this function has two callers that must never
// disagree: the composer draws a chip per match while the writer types, and the
// develop route feeds the same matches to the model. A divergence there is
// invisible — the chips promise a character the model was never told about, and
// the picture comes back with a stranger's face.

import { describe, expect, test } from "bun:test"

import {
  BRIEF_LORE_CHAR_BUDGET,
  matchBriefLore,
  selectBriefLore,
} from "@/lib/images/brief-lore"
import type { LorebookEntry } from "@/lib/types"

function entry(overrides: Partial<LorebookEntry> = {}): LorebookEntry {
  return {
    id: "e1",
    storyId: "s1",
    name: "Lara",
    category: "character",
    keys: ["lara"],
    content: "A tomb raider — dark braid, torn jacket.",
    enabled: true,
    alwaysActive: false,
    priority: 50,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }
}

const names = (entries: LorebookEntry[], brief: string) =>
  matchBriefLore(entries, brief).map((match) => match.entry.name)

describe("matchBriefLore", () => {
  test("matches a key the brief names, case-insensitively", () => {
    expect(names([entry()], "Lara at the tomb door, torch raised")).toEqual([
      "Lara",
    ])
  })

  test("leaves out an entry the brief never names", () => {
    expect(names([entry()], "an empty street at dawn")).toEqual([])
  })

  test("an always-active entry rides whatever the brief says", () => {
    // A lorebook that says "this world has two moons" means it whether or not
    // the writer typed the word moon.
    const moons = entry({
      id: "e2",
      name: "Two moons",
      keys: ["moon"],
      alwaysActive: true,
    })
    expect(names([moons], "a coin on a counter")).toEqual(["Two moons"])
  })

  test("an empty brief still carries the always-active entries", () => {
    const moons = entry({ id: "e2", name: "Two moons", alwaysActive: true })
    expect(names([entry(), moons], "")).toEqual(["Two moons"])
  })

  test("cascades: a matched entry's own text pulls in what it names", () => {
    const lara = entry({
      content: "A tomb raider who works out of Croft Manor.",
    })
    const manor = entry({
      id: "e2",
      name: "Croft Manor",
      keys: ["croft manor"],
      content: "A gabled house above the valley.",
    })
    expect(names([lara, manor], "Lara at the door")).toEqual([
      "Lara",
      "Croft Manor",
    ])
  })

  test("a disabled entry never matches, however loudly the brief names it", () => {
    expect(names([entry({ enabled: false })], "Lara at the door")).toEqual([])
  })

  test("orders by priority, so trimming keeps what the writer weighted", () => {
    const lara = entry({ priority: 10 })
    const tomb = entry({
      id: "e2",
      name: "The tomb",
      keys: ["tomb"],
      priority: 90,
    })
    expect(names([lara, tomb], "Lara at the tomb door")).toEqual([
      "The tomb",
      "Lara",
    ])
  })
})

describe("selectBriefLore", () => {
  const picked = (
    entries: LorebookEntry[],
    brief: string,
    excluded: Set<string> = new Set()
  ) =>
    selectBriefLore(entries, brief, excluded).map((match) => match.entry.name)

  test("a muted entry is out, and its room goes to the next in line", () => {
    const big = entry({
      id: "big",
      name: "Big",
      priority: 90,
      content: "x".repeat(BRIEF_LORE_CHAR_BUDGET),
    })
    const small = entry({ id: "small", name: "Small", priority: 10 })
    expect(picked([big, small], "Lara at the door", new Set(["big"]))).toEqual([
      "Small",
    ])
  })

  test("trims past the budget in match order", () => {
    const half = Math.ceil(BRIEF_LORE_CHAR_BUDGET / 2)
    const make = (id: string, priority: number) =>
      entry({ id, name: id, priority, content: "x".repeat(half) })
    expect(
      picked(
        [make("first", 90), make("second", 80), make("third", 70)],
        "Lara at the door"
      )
    ).toEqual(["first", "second"])
  })

  test("an entry that fits still rides after a larger one was refused", () => {
    const nearly = entry({
      id: "nearly",
      name: "Nearly",
      priority: 90,
      content: "x".repeat(BRIEF_LORE_CHAR_BUDGET - 10),
    })
    const over = entry({
      id: "over",
      name: "Over",
      priority: 80,
      content: "x".repeat(100),
    })
    const fits = entry({
      id: "fits",
      name: "Fits",
      priority: 70,
      content: "ok",
    })
    expect(picked([nearly, over, fits], "Lara at the door")).toEqual([
      "Nearly",
      "Fits",
    ])
  })
})
