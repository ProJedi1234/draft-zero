// tests/novelai-import.test.ts — What a NovelAI `.scenario` is allowed to turn
// into.
//
// This file exists because it didn't. The scenario reader shipped untested, and
// the gap went unnoticed until a one-line change to its category table — adding
// a "class" row for the AI Dungeon importer — silently re-filed lore in every
// scenario carrying a folder named "Object Classes" or "Professions & Guilds",
// with a green suite the whole time.
//
// The category table is the part under test here, because it is the part that
// fails quietly: a misfiled entry still imports, still renders, and still
// reaches the model. Nothing about it looks wrong until a writer goes looking
// for their items and finds them filed as classes.

import { describe, expect, test } from "bun:test"

import { parseScenario } from "@/lib/import/novelai"
import type { LorebookCategory } from "@/lib/types"

/** Unwraps a parse that is expected to succeed, failing loudly if it didn't. */
function parsed(input: string | unknown) {
  const result = parseScenario(input)
  if (!result.ok) throw new Error(`expected a parse, got: ${result.error}`)
  return result.data
}

/** The minimum a scenario needs: `prompt` is the field every revision has. */
function scenario(lorebook: unknown, extra: Record<string, unknown> = {}) {
  return { prompt: "You wake in Decsos.", lorebook, ...extra }
}

/** One lorebook entry in the category folder `categoryName`. */
function withCategory(categoryName: string) {
  return scenario({
    categories: [{ id: "cat-1", name: categoryName }],
    entries: [
      {
        displayName: "Thing",
        text: "A thing.",
        keys: ["thing"],
        category: "cat-1",
      },
    ],
  })
}

// ---------------------------------------------------------------------------
// Category folders
// ---------------------------------------------------------------------------

describe("parseScenario — category mapping", () => {
  const CASES: Array<[string, LorebookCategory]> = [
    // The plain readings.
    ["Characters", "character"],
    ["Places", "location"],
    ["Factions", "faction"],
    ["Items", "item"],
    ["Events", "event"],
    ["Magic", "concept"],
    ["Classes", "class"],
    ["Archetypes", "class"],

    // The compound ones, which are where an unanchored or badly ordered rule
    // does its damage. Each of these regressed when a "class" row was added
    // high in the table: they landed in "class" instead of the reading below.
    ["Object Classes", "item"],
    ["Professions & Guilds", "faction"],
    ["Character Classes", "character"],

    // "Classified" is not "class". Word anchoring is what keeps it out.
    ["Classified Documents", "concept"],
  ]

  for (const [folder, category] of CASES) {
    test(`"${folder}" lands in ${category}`, () => {
      const data = parsed(withCategory(folder))
      expect(data.lorebookEntries[0].category).toBe(category)
    })
  }

  test("an unrecognised folder falls back to concept", () => {
    expect(parsed(withCategory("Blorbo")).lorebookEntries[0].category).toBe(
      "concept" satisfies LorebookCategory
    )
  })

  test("an entry with no folder at all falls back to concept", () => {
    const data = parsed(
      scenario({ entries: [{ displayName: "Thing", text: "A thing." }] })
    )
    expect(data.lorebookEntries[0].category).toBe("concept")
  })
})

// ---------------------------------------------------------------------------
// Lore text
// ---------------------------------------------------------------------------

describe("parseScenario — lorebook entries", () => {
  test("entry text is stored verbatim, not reflowed", () => {
    const block = "Elara Vance\nAge: 24\n  Home: Somara"
    const data = parsed(
      scenario({ entries: [{ displayName: "Elara", text: block }] })
    )
    expect(data.lorebookEntries[0].content).toBe(block)
  })

  test("forceActivation becomes alwaysActive", () => {
    const data = parsed(
      scenario({
        entries: [
          { displayName: "World", text: "It rains.", forceActivation: true },
        ],
      })
    )
    expect(data.lorebookEntries[0].alwaysActive).toBe(true)
  })

  test("an entry with no text is skipped and reported", () => {
    const data = parsed(
      scenario({
        entries: [
          { displayName: "Real", text: "Something." },
          { displayName: "Blank", text: "" },
        ],
      })
    )
    expect(data.lorebookEntries).toHaveLength(1)
    expect(data.warnings).toContain("Skipped 1 empty lorebook entry.")
  })

  test("a regex key is lowered to its pattern text and reported", () => {
    const data = parsed(
      scenario({
        entries: [{ displayName: "Elf", text: "Tall.", keys: ["/elv(en)?/i"] }],
      })
    )
    expect(data.lorebookEntries[0].keys).toEqual(["elv(en)?"])
    expect(
      data.warnings.some((warning) => warning.includes("Regex lorebook keys"))
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Rejections and format recognition
// ---------------------------------------------------------------------------

describe("parseScenario — rejections", () => {
  test("an empty file", () => {
    const result = parseScenario("")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe("The file is empty.")
  })

  test("invalid JSON", () => {
    const result = parseScenario("{ not json")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe("That file isn't valid JSON.")
  })

  test("an AI Dungeon card array is not claimed", () => {
    // The import picker offers a file to both readers, so this reader must not
    // claim a card export — nor be handed one it would mangle.
    const result = parseScenario([{ keys: "Somara", value: "A town." }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.recognised).toBe(false)
  })

  test("an object with scenario markers but no prompt IS claimed", () => {
    const result = parseScenario({
      scenarioVersion: 3,
      lorebook: { entries: [] },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.recognised).toBe(true)
  })
})
