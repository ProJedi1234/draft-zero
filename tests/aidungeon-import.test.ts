// tests/aidungeon-import.test.ts — What an AI Dungeon story-card export is
// allowed to turn into.
//
// This reader is the only thing standing between a stranger's JSON file and a
// writer's lorebook, and every one of its failure modes is quiet. A card whose
// text silently lands on the floor, a comma-separated key string stored as one
// unmatchable key, a `worldDescription` that stops being always-active — none
// of those throw, none of them show up in the dialog's preview counts, and all
// of them only surface much later as a generation that has forgotten the world
// it is set in. So the assertions here are on exact values: the category each
// card type lands in, the exact key array, the exact content string.
//
// The real 26-card sample lives in tests/fixtures/aidungeon-cards.json rather
// than inline, because the point of testing against it is that it is the actual
// bytes AI Dungeon wrote — an inlined paraphrase would drift into whatever the
// parser happens to accept. The hand-written cases below cover the shapes the
// sample happens not to contain (a wrapper object, missing fields, duplicate
// titles), which is exactly the ground a single real file can't.
//
// The rejection cases matter as much as the happy ones: a NovelAI .scenario is
// also a plausible-looking JSON story export, and importing one as "zero cards"
// would be worse than refusing it.

import { describe, expect, test } from "bun:test"

import { parseStoryCards } from "@/lib/import/aidungeon"
import type { LorebookCategory } from "@/lib/types"

import SAMPLE_CARDS from "./fixtures/aidungeon-cards.json"

/** Unwraps a parse that is expected to succeed, failing loudly if it didn't. */
function parsed(input: string | unknown) {
  const result = parseStoryCards(input)
  if (!result.ok) throw new Error(`expected a parse, got: ${result.error}`)
  return result.data
}

const CARD = {
  keys: "Somara",
  value: "Somara is a small farming town.",
  type: "location",
  title: "Somara",
  description: "Somara is a small farming town.",
  useForCharacterCreation: true,
}

// ---------------------------------------------------------------------------
// The real export
// ---------------------------------------------------------------------------

describe("parseStoryCards — the sample export", () => {
  test("all 26 cards land", () => {
    expect(parsed(SAMPLE_CARDS).lorebookEntries).toHaveLength(26)
  })

  test("the card types split across our categories exactly", () => {
    const counts: Record<string, number> = {}
    for (const entry of parsed(SAMPLE_CARDS).lorebookEntries) {
      counts[entry.category] = (counts[entry.category] ?? 0) + 1
    }
    // 8 location · 3 faction · 6 race → character · 8 class ·
    // 1 worldDescription → concept. No literal `character`, `item` or `event`
    // card here: this sample happens to carry none, though the format has all
    // three. Classes were the reason draft-zero grew a "class" category — a
    // third of this file used to land in the concept catch-all.
    expect(counts).toEqual({
      location: 8,
      faction: 3,
      character: 6,
      class: 8,
      concept: 1,
    })
  })

  test("the worldDescription card is surfaced for memory and kept as lore", () => {
    const data = parsed(SAMPLE_CARDS)
    expect(data.worldDescription.startsWith("Xaxas is a world of peace")).toBe(
      true
    )

    const xaxas = data.lorebookEntries.find((entry) => entry.name === "Xaxas")
    expect(xaxas?.alwaysActive).toBe(true)
    expect(xaxas?.category).toBe("concept" satisfies LorebookCategory)
    expect(xaxas?.content).toBe(data.worldDescription)
    // Every other card triggers on its keys alone.
    expect(
      data.lorebookEntries.filter((entry) => entry.alwaysActive)
    ).toHaveLength(1)
  })

  test("a multi-key card keeps every trigger, trimmed", () => {
    // The sample's Elf card is `" elf, elv"` — leading space and all.
    const elf = parsed(SAMPLE_CARDS).lorebookEntries.find(
      (entry) => entry.name === "Elf"
    )
    expect(elf?.keys).toEqual(["elf", "elv"])
  })

  test("a card with an empty value falls back to its description", () => {
    // "Uruk" is the one sample card whose `value` is empty.
    const uruk = parsed(SAMPLE_CARDS).lorebookEntries.find(
      (entry) => entry.name === "Uruk"
    )
    expect(uruk?.content.startsWith("Uruk is a town in the empire")).toBe(true)
    expect(uruk?.category).toBe("location")
  })

  test("a bare array with no title is named after its world", () => {
    expect(parsed(SAMPLE_CARDS).title).toBe("Xaxas")
  })

  // Every type in this export now has a category of its own, so a clean file
  // imports silently. Warnings are for the writer's attention, and a file that
  // needed none should not spend any.
  test("a file whose every type is known imports without a warning", () => {
    expect(parsed(SAMPLE_CARDS).warnings).toEqual([])
  })

  test("the same bytes parse from raw text", () => {
    const fromText = parsed(JSON.stringify(SAMPLE_CARDS))
    expect(fromText).toEqual(parsed(SAMPLE_CARDS))
  })
})

// ---------------------------------------------------------------------------
// Both file shapes
// ---------------------------------------------------------------------------

const WRAPPER_KEYS = ["storyCards", "story_cards", "cards"] as const

describe("parseStoryCards — file shapes", () => {
  for (const key of WRAPPER_KEYS) {
    test(`a wrapper object carrying the list under "${key}"`, () => {
      const data = parsed({ [key]: [CARD] })
      expect(data.lorebookEntries).toHaveLength(1)
    })
  }

  test("a wrapper's scenario fields carry through to the new-story path", () => {
    const data = parsed({
      title: "The Kingdom of Yalann",
      description: "A gnomish town on the edge of a rebellion.",
      prompt: "You wake in Decsos.\nThe bells are ringing.",
      memory: "The taxes have not been paid in three seasons.",
      authorsNote: "Write in close third person.",
      tags: ["fantasy", "intrigue", "fantasy"],
      storyCards: [CARD],
    })
    expect(data.title).toBe("The Kingdom of Yalann")
    expect(data.description).toBe("A gnomish town on the edge of a rebellion.")
    // Single newlines are promoted to paragraph breaks (lib/markdown.ts).
    expect(data.prompt).toBe("You wake in Decsos.\n\nThe bells are ringing.")
    expect(data.memory).toBe("The taxes have not been paid in three seasons.")
    expect(data.authorsNote).toBe("Write in close third person.")
    expect(data.tags).toEqual(["fantasy", "intrigue"])
  })

  test("a bare array carries no scenario fields and no invented ones", () => {
    const data = parsed([CARD])
    expect(data.description).toBe("")
    expect(data.prompt).toBe("")
    expect(data.memory).toBe("")
    expect(data.authorsNote).toBe("")
    expect(data.tags).toEqual([])
    expect(data.worldDescription).toBe("")
    // No worldDescription card to borrow a name from.
    expect(data.title).toBe("Imported story cards")
  })
})

// ---------------------------------------------------------------------------
// Rejections
// ---------------------------------------------------------------------------

type RejectionCase = readonly [name: string, input: unknown, error: string]

const REJECTIONS: readonly RejectionCase[] = [
  ["an empty file", "", "The file is empty."],
  ["whitespace only", "   \n  ", "The file is empty."],
  ["not JSON at all", "{nope", "That file isn't valid JSON."],
  ["a bare string", '"just a string"', "That file isn't an AI Dungeon export."],
  ["a number", "42", "That file isn't an AI Dungeon export."],
  ["an empty array", [], "That file has no story cards in it."],
  [
    "an empty card list on a wrapper",
    { storyCards: [] },
    "That file has no story cards in it.",
  ],
  [
    "an array of non-cards",
    ["Decsos", 7, null],
    "None of the story cards in that file have any text.",
  ],
  [
    "cards with titles but no text",
    [{ title: "Decsos", keys: "Decsos", value: "", description: "" }],
    "None of the story cards in that file have any text.",
  ],
  [
    "a NovelAI scenario",
    {
      scenarioVersion: 3,
      title: "The Tower",
      prompt: "You climb.",
      context: [{ text: "Memory" }, { text: "Note" }],
      lorebook: { entries: [{ displayName: "Tower", text: "Tall." }] },
    },
    "That file isn't an AI Dungeon export — no story cards in it.",
  ],
]

describe("parseStoryCards — rejections", () => {
  for (const [name, input, error] of REJECTIONS) {
    test(name, () => {
      const result = parseStoryCards(input)
      expect(result).toEqual({ ok: false, error })
    })
  }
})

// ---------------------------------------------------------------------------
// Partial and awkward cards
// ---------------------------------------------------------------------------

describe("parseStoryCards — partial cards", () => {
  test("a card with no title is named after its first key", () => {
    const data = parsed([{ ...CARD, title: "" }])
    expect(data.lorebookEntries[0].name).toBe("Somara")
    expect(data.warnings).toContain(
      "1 card had no title — named after its first trigger word."
    )
  })

  test("a card with neither title nor keys is still importable", () => {
    const data = parsed([{ value: "A rumour with no name.", type: "location" }])
    expect(data.lorebookEntries[0]).toEqual({
      name: "Untitled entry",
      category: "location",
      keys: [],
      content: "A rumour with no name.",
      enabled: true,
      alwaysActive: false,
      priority: 50,
    })
    // It has nothing to fire on, so it says that rather than claiming — as it
    // once did — that it was named after a trigger word it never had.
    expect(data.warnings).toEqual([
      "1 card has no title and no trigger words — it won't reach a generation until you give it one.",
    ])
  })

  test("a keys string of separators alone is no triggers at all", () => {
    const data = parsed([{ keys: ",,,,", value: "A body with no keys." }])
    expect(data.lorebookEntries[0].keys).toEqual([])
    expect(data.warnings).toEqual([
      "1 card has no title and no trigger words — it won't reach a generation until you give it one.",
    ])
  })

  test("a card with no keys triggers on its title", () => {
    const data = parsed([{ ...CARD, keys: "" }])
    expect(data.lorebookEntries[0].keys).toEqual(["Somara"])
    expect(data.warnings).toContain(
      "1 card had no trigger words — their titles are the trigger instead."
    )
  })

  test("character and item cards land in their own categories", () => {
    const data = parsed([
      { ...CARD, type: "character", title: "Elara", keys: "Elara" },
      { ...CARD, type: "item", title: "Sunblade", keys: "Sunblade" },
    ])
    expect(data.lorebookEntries.map((entry) => entry.category)).toEqual([
      "character",
      "item",
    ])
    expect(data.warnings).toEqual([])
  })

  test("a type that names an Object member is just unrecognised", () => {
    // `type in CARD_CATEGORIES` used to be true for every inherited key, which
    // wrote Object.prototype itself into the category column.
    for (const type of ["__proto__", "constructor", "toString"]) {
      const data = parsed([{ ...CARD, type }])
      expect(data.lorebookEntries[0].category).toBe(
        "concept" satisfies LorebookCategory
      )
      expect(data.warnings).toContain(
        `Unrecognised card type (${type}) became Concepts.`
      )
    }
  })

  test("an unrecognised type lands in concepts and says so", () => {
    const data = parsed([{ ...CARD, type: "beverage" }])
    expect(data.lorebookEntries[0].category).toBe("concept")
    expect(data.warnings).toContain(
      "Unrecognised card type (beverage) became Concepts."
    )
  })

  test("blank cards are skipped and counted, not dropped in silence", () => {
    const data = parsed([CARD, { title: "Blank", keys: "blank" }, null])
    expect(data.lorebookEntries).toHaveLength(1)
    expect(data.warnings).toContain("Skipped 2 empty story cards.")
  })
})

describe("parseStoryCards — content", () => {
  test("a differing description is kept alongside the value", () => {
    const data = parsed([
      {
        ...CARD,
        value: "Somara is a small farming town.",
        description: "The player grew up here.",
      },
    ])
    expect(data.lorebookEntries[0].content).toBe(
      "Somara is a small farming town.\n\nThe player grew up here."
    )
  })

  test("an identical description is not written twice", () => {
    expect(parsed([CARD]).lorebookEntries[0].content).toBe(
      "Somara is a small farming town."
    )
  })

  test("several worldDescription cards join into one memory seed", () => {
    const data = parsed([
      {
        keys: "Xaxas",
        type: "worldDescription",
        title: "Xaxas",
        value: "Peace.",
      },
      {
        keys: "Rift",
        type: "worldDescription",
        title: "The Rift",
        value: "War.",
      },
    ])
    expect(data.worldDescription).toBe("Peace.\n\nWar.")
    expect(data.lorebookEntries.every((entry) => entry.alwaysActive)).toBe(true)
    // The first world card names the story when the file has no title.
    expect(data.title).toBe("Xaxas")
  })
})

describe("parseStoryCards — keys", () => {
  test("comma splitting trims, drops empties, and folds duplicates", () => {
    const data = parsed([{ ...CARD, keys: " elf , elv,, Elf ,elf,  " }])
    // Case-folded dedupe keeps the first spelling: the editor shows keys
    // verbatim, and the matcher lowercases both sides anyway.
    expect(data.lorebookEntries[0].keys).toEqual(["elf", "elv"])
  })

  test("a non-string keys field is not a crash", () => {
    const data = parsed([{ ...CARD, keys: ["a", "b"] }])
    expect(data.lorebookEntries[0].keys).toEqual(["Somara"])
  })
})

describe("parseStoryCards — duplicates", () => {
  test("duplicate titles are imported separately and reported once", () => {
    const data = parsed([
      { ...CARD, value: "The first Somara." },
      { ...CARD, value: "The second Somara." },
      { ...CARD, title: "somara", value: "The third." },
    ])
    expect(data.lorebookEntries).toHaveLength(3)
    expect(data.warnings).toContain(
      "Duplicate card titles (Somara, somara) were imported as separate entries."
    )
  })
})

// ---------------------------------------------------------------------------
// Card types
//
// `type` is free text, and a real export mixes AI Dungeon's title-cased UI
// labels with the lowercase defaults and with types the writer invented. An
// earlier version matched the type exactly and case-sensitively, which filed a
// file's "Character" cards as Concepts and — worse — made a "World Description"
// card ordinary lore, silently skipping the memory it should have seeded.
// ---------------------------------------------------------------------------

describe("parseStoryCards — card types", () => {
  test("the type is matched regardless of case", () => {
    const data = parsed([
      { ...CARD, title: "A", type: "Character" },
      { ...CARD, title: "B", type: "LOCATION" },
      { ...CARD, title: "C", type: "FaCtIoN" },
    ])
    expect(data.lorebookEntries.map((e) => e.category)).toEqual([
      "character",
      "location",
      "faction",
    ])
    // An exact hit is a translation, not a guess, so nothing is reported.
    expect(data.warnings).toEqual([])
  })

  test("spacing and punctuation in the type carry no meaning", () => {
    const data = parsed([
      { ...CARD, title: "A", type: "World Description" },
      { ...CARD, title: "B", type: "world_description" },
    ])
    expect(data.lorebookEntries.every((e) => e.alwaysActive)).toBe(true)
    expect(data.worldDescription).not.toBe("")
  })

  test("AI Dungeon's invented types land where a writer would put them", () => {
    const data = parsed([
      { ...CARD, title: "A", type: "Object" },
      { ...CARD, title: "B", type: "Race" },
      { ...CARD, title: "C", type: "npc" },
    ])
    expect(data.lorebookEntries.map((e) => e.category)).toEqual([
      "item",
      "character",
      "character",
    ])
  })

  test("an unanticipated type is filed by keyword and reported", () => {
    const data = parsed([
      { ...CARD, title: "A", type: "Magic System" },
      { ...CARD, title: "B", type: "Major Character" },
    ])
    expect(data.lorebookEntries.map((e) => e.category)).toEqual([
      "concept",
      "character",
    ])
    // A guess is reported even though it found a home — only the writer knows
    // whether their vocabulary landed where they meant it to.
    expect(data.warnings).toContain(
      "Filed by name: Magic System → Concept, Major Character → Character."
    )
  })

  test("a type with no home at all still imports, as a Concept", () => {
    const data = parsed([{ ...CARD, title: "A", type: "Blorbo" }])
    expect(data.lorebookEntries[0].category).toBe("concept")
    expect(data.warnings).toContain(
      "Unrecognised card type (Blorbo) became Concepts."
    )
  })

  test("a type named for an Object member is unrecognised, not a category", () => {
    const data = parsed([
      { ...CARD, title: "A", type: "constructor" },
      { ...CARD, title: "B", type: "__proto__" },
    ])
    expect(data.lorebookEntries.map((e) => e.category)).toEqual([
      "concept",
      "concept",
    ])
  })
})
