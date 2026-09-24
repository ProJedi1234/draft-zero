// lib/services/import.test.ts — the importers against a scripted drizzle chain
// and the real sync bus. The parsers run for real; their own specs live in
// tests/*-import.test.ts, so this one checks what the services write with them.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { MAX_BACKUP_BYTES } from "@/lib/import/aidungeon-backup"
import { MAX_CARDS_BYTES } from "@/lib/import/aidungeon"
import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"
import {
  backupImportOutput,
  scenarioImportOutput,
  storyCardImportOutput,
  storyCardMergeOutput,
} from "@/lib/services/import.schema"
import { captureBus, installFakeDb } from "@/lib/services/test-support"

const db = installFakeDb()
installQueryMocks()
const importer = await import("@/lib/services/import")

const STORY = "11111111-1111-4111-8111-111111111111"
const PROFILE = "33333333-3333-4333-8333-333333333333"
const CTX = { origin: "device-a" }

const NOT_A_FILE = "That import didn't arrive as a file."
const TOO_LARGE = "That file is too large to be an export."

const BACKUP_PATH = new URL(
  "../../tests/fixtures/aidungeon-backup.zip",
  import.meta.url
).pathname

function scenarioText(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title: "The ${Place[Decsos]} Affair",
    prompt: "You wake in ${Place[Decsos]}.",
    context: [{ text: "Memory text." }, { text: "Author's note." }],
    lorebook: {
      entries: [{ displayName: "Vell", text: "A wanderer.", keys: ["vell"] }],
    },
    ...extra,
  })
}

function cardsText(
  cards: Array<{ title: string; type?: string; value?: string }> = [
    { title: "Decsos", type: "location" },
    { title: "Vell", type: "character" },
  ]
): string {
  return JSON.stringify(
    cards.map((card) => ({
      keys: card.title,
      value: card.value ?? `${card.title} lore.`,
      type: card.type ?? "character",
      title: card.title,
    }))
  )
}

/** Every `values(...)` payload statement `index` inserted, as rows. */
function insertedRows(index: number): Record<string, unknown>[] {
  const values = db.argsOf(index, "values")?.[0]
  return (Array.isArray(values) ? values : [values]) as Record<
    string,
    unknown
  >[]
}

function roots(): string[] {
  return db.statements.map((s) => s.root)
}

let bus: Awaited<ReturnType<typeof captureBus>>

beforeEach(async () => {
  db.reset()
  stubQueries({
    getAppSettings: async () => ({ defaultProfileId: PROFILE }),
  })
  bus = await captureBus()
})

afterEach(() => bus.stop())

describe("importScenario", () => {
  test("writes the story, prompt and lore in one go, then tells the library", async () => {
    const result = await importer.importScenario(
      { json: scenarioText(), placeholderValues: { Place: "Yalann" } },
      CTX
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const data = scenarioImportOutput.parse(result.data)
    expect(data).toMatchObject({
      title: "The Yalann Affair",
      lorebookEntryCount: 1,
    })
    expect(roots()).toEqual(["insert", "insert", "insert"])

    const [story] = insertedRows(0)
    expect(story).toMatchObject({
      id: data.storyId,
      title: "The Yalann Affair",
      profileId: PROFILE,
    })
    const [prompt] = insertedRows(1)
    expect(prompt).toMatchObject({
      storyId: data.storyId,
      position: 0,
      variantGroupId: prompt.id,
      source: "user",
      text: "You wake in Yalann.",
    })
    expect(prompt.actionKind).toBeUndefined()
    const [lore] = insertedRows(2)
    expect(lore).toMatchObject({
      storyId: data.storyId,
      name: "Vell",
      keysJson: '["vell"]',
    })

    expect(db.revalidated).toEqual(["/"])
    expect(bus.events).toEqual([{ kind: "change", storyId: null }])
  })

  test("placeholders fall back to their defaults when no values arrive", async () => {
    const result = await importer.importScenario({ json: scenarioText() }, CTX)
    expect(result.ok && result.data.title).toBe("The Decsos Affair")
  })

  test("refuses with the old sentences and writes nothing", async () => {
    const cases: Array<[unknown, string]> = [
      [{ json: 42 }, NOT_A_FILE],
      [{ json: [scenarioText()] }, NOT_A_FILE],
      // Under the cap in UTF-16 units, three times over it in bytes.
      [{ json: "語".repeat(1024 * 1024) }, TOO_LARGE],
      [
        { json: scenarioText(), placeholderValues: { Place: 1 } },
        "Placeholder values must be text.",
      ],
      [{ json: "{" }, "That file isn't valid JSON."],
      [
        { json: "{}" },
        "That file isn't a NovelAI scenario — no story prompt in it.",
      ],
    ]
    for (const [input, error] of cases) {
      const result = await importer.importScenario(input as never, CTX)
      expect(result).toEqual({ ok: false, code: "invalid", error })
    }
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([])
  })
})

describe("importStoryCards", () => {
  test("creates a story wearing the cards' setting", async () => {
    const result = await importer.importStoryCards({ json: cardsText() }, CTX)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const data = storyCardImportOutput.parse(result.data)
    expect(data.lorebookEntryCount).toBe(2)
    // No prompt in a card file, so no manuscript row.
    expect(roots()).toEqual(["insert", "insert"])
    expect(insertedRows(0)[0]).toMatchObject({
      id: data.storyId,
      profileId: PROFILE,
    })
    expect(insertedRows(1).map((row) => row.name)).toEqual(["Decsos", "Vell"])
    expect(db.revalidated).toEqual(["/"])
    expect(bus.events).toEqual([{ kind: "change", storyId: null }])
  })

  test("refuses with the old sentences and writes nothing", async () => {
    const cases: Array<[unknown, string]> = [
      [{}, NOT_A_FILE],
      [{ json: "x".repeat(MAX_CARDS_BYTES + 1) }, TOO_LARGE],
      [{ json: "" }, "The file is empty."],
      [{ json: "[]" }, "That file has no story cards in it."],
    ]
    for (const [input, error] of cases) {
      const result = await importer.importStoryCards(input as never, CTX)
      expect(result).toEqual({ ok: false, code: "invalid", error })
    }
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([])
  })
})

describe("importAiDungeonBackup", () => {
  test("writes the manuscript, recap and lore of a real backup", async () => {
    const file = new File([await Bun.file(BACKUP_PATH).arrayBuffer()], "b.zip")
    const result = await importer.importAiDungeonBackup({ file }, CTX)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const data = backupImportOutput.parse(result.data)
    expect(data.passageCount).toBeGreaterThan(0)
    expect(insertedRows(0)[0]).toMatchObject({
      id: data.storyId,
      profileId: PROFILE,
    })
    const passages = insertedRows(1)
    expect(passages).toHaveLength(data.passageCount)
    expect(passages.map((row) => row.position)).toEqual(
      passages.map((_, index) => index)
    )
    for (const row of passages) expect(row.variantGroupId).toBe(row.id)
    expect(db.revalidated).toEqual(["/"])
    expect(bus.events).toEqual([{ kind: "change", storyId: null }])
  })

  test("refuses with the old sentences and writes nothing", async () => {
    const huge = new File([new Uint8Array(MAX_BACKUP_BYTES + 1)], "big.zip")
    const cases: Array<[unknown, string]> = [
      [{ file: "PK…" }, NOT_A_FILE],
      [{ file: huge }, "That backup is too large to import."],
    ]
    for (const [input, error] of cases) {
      const result = await importer.importAiDungeonBackup(input as never, CTX)
      expect(result).toEqual({ ok: false, code: "invalid", error })
    }

    const junk = await importer.importAiDungeonBackup(
      { file: new File(["not a zip"], "junk.zip") },
      CTX
    )
    expect(junk.ok || junk.code).toBe("invalid")
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([])
  })
})

describe("importStoryCardsIntoStory", () => {
  test("skips names the story holds and announces an uncovered lore change", async () => {
    db.next([{ id: STORY }])
    db.next([{ name: "  decsos " }])
    const result = await importer.importStoryCardsIntoStory(
      { storyId: STORY, json: cardsText() },
      CTX
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(storyCardMergeOutput.parse(result.data)).toMatchObject({
      storyId: STORY,
      lorebookEntryCount: 1,
      skippedCount: 1,
    })
    expect(result.data.warnings).toContain(
      "Skipped 1 card already in this lorebook by name."
    )
    expect(roots()).toEqual(["select", "select", "insert"])
    expect(insertedRows(2)).toEqual([
      expect.objectContaining({ storyId: STORY, name: "Vell" }),
    ])
    expect(db.revalidated).toEqual(["/"])
    expect(bus.events).toEqual([
      { kind: "change", storyId: STORY, entities: ["lorebook-entry"] },
    ])
  })

  test("inserts in chunks the bind-parameter cap can hold", async () => {
    db.next([{ id: STORY }])
    db.next([])
    const cards = Array.from({ length: 1001 }, (_, i) => ({ title: `C${i}` }))
    const result = await importer.importStoryCardsIntoStory(
      { storyId: STORY, json: cardsText(cards) },
      CTX
    )
    expect(result.ok && result.data.lorebookEntryCount).toBe(1001)
    expect(roots()).toEqual(["select", "select", "insert", "insert"])
    expect(insertedRows(2)).toHaveLength(1000)
    expect(insertedRows(3)).toHaveLength(1)
  })

  test("a missing story is not_found and publishes nothing", async () => {
    db.next([])
    const result = await importer.importStoryCardsIntoStory(
      { storyId: STORY, json: cardsText() },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "not_found",
      error: "Story not found.",
    })
    expect(roots()).toEqual(["select"])
    expect(bus.events).toEqual([])
  })

  test("checks the file before the story id, as the old action did", async () => {
    const cases: Array<[unknown, string]> = [
      [{ storyId: "not an id", json: 1 }, NOT_A_FILE],
      [{ storyId: "not an id", json: cardsText() }, "Invalid story id."],
      [{ storyId: STORY, json: "{" }, "That file isn't valid JSON."],
    ]
    for (const [input, error] of cases) {
      const result = await importer.importStoryCardsIntoStory(
        input as never,
        CTX
      )
      expect(result).toEqual({ ok: false, code: "invalid", error })
    }
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([])
  })
})
