// lib/services/lorebook.test.ts — the lorebook service against a scripted
// drizzle chain and the real sync bus. No live DB, no HTTP.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import {
  deleteLorebookEntryOutput,
  lorebookEntryWriteOutput,
} from "@/lib/services/lorebook.schema"
import { captureBus, installFakeDb } from "@/lib/services/test-support"

const db = installFakeDb()
const lorebook = await import("@/lib/services/lorebook")

const STORY = "11111111-1111-4111-8111-111111111111"
const ENTRY = "22222222-2222-4222-8222-222222222222"
const CTX = { origin: "device-a" }

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY,
    storyId: STORY,
    name: "Vell",
    category: "character",
    keysJson: '["vell"]',
    content: "A wanderer.",
    enabled: true,
    alwaysActive: false,
    priority: 50,
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
    ...overrides,
  }
}

let bus: Awaited<ReturnType<typeof captureBus>>

beforeEach(async () => {
  db.reset()
  bus = await captureBus()
})

afterEach(() => bus.stop())

describe("createLorebookEntry", () => {
  test("inserts with defaults, returns the record and publishes it", async () => {
    db.next([row()])
    const result = await lorebook.createLorebookEntry(
      { storyId: STORY, id: ENTRY, name: "  Vell  " },
      CTX
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(lorebookEntryWriteOutput.parse(result.data).record.id).toBe(ENTRY)
    expect(db.argsOf(0, "values")?.[0]).toMatchObject({
      id: ENTRY,
      name: "Vell",
      category: "concept",
      keysJson: "[]",
      content: "",
      enabled: true,
      alwaysActive: false,
      priority: 50,
    })
    expect(db.revalidated).toEqual(["/"])
    expect(bus.events).toEqual([
      expect.objectContaining({
        kind: "entity",
        op: "upsert",
        entity: "lorebook-entry",
        id: ENTRY,
        storyId: STORY,
        origin: "device-a",
      }),
      { kind: "change", storyId: STORY, covered: true },
    ])
  })

  test("a retried id reads back the row the first attempt wrote", async () => {
    db.next([])
    db.next([row({ name: "First" })])
    const result = await lorebook.createLorebookEntry(
      { storyId: STORY, id: ENTRY, name: "Second" },
      CTX
    )
    expect(result.ok && result.data.record.name).toBe("First")
    expect(db.statements.map((s) => s.root)).toEqual(["insert", "select"])
  })

  test("rejects in the old action's order, with its sentences", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ storyId: "not an id", name: "" }, "Invalid story id."],
      [{ storyId: STORY, name: "   " }, "Name is required."],
      [{ storyId: STORY, name: "Vell", id: "bad id" }, "Invalid entry id."],
    ]
    for (const [input, error] of cases) {
      const result = await lorebook.createLorebookEntry(input as never, CTX)
      expect(result).toEqual({ ok: false, code: "invalid", error })
    }
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([])
  })
})

describe("updateLorebookEntry", () => {
  test("patches only the given fields and bumps updated_at", async () => {
    db.next([row({ content: "Changed." })])
    const result = await lorebook.updateLorebookEntry(
      { id: ENTRY, patch: { content: "Changed.", keys: ["a", "b"] } },
      CTX
    )
    expect(result.ok).toBe(true)
    const set = db.argsOf(0, "set")?.[0] as Record<string, unknown>
    expect(Object.keys(set).sort()).toEqual([
      "content",
      "keysJson",
      "updatedAt",
    ])
    expect(set.keysJson).toBe('["a","b"]')
    expect(bus.events[0]).toMatchObject({ op: "upsert", origin: "device-a" })
  })

  test("a missing row is not_found and publishes nothing", async () => {
    db.next([])
    const result = await lorebook.updateLorebookEntry(
      { id: ENTRY, patch: { content: "x" } },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "not_found",
      error: "Lorebook entry not found.",
    })
    expect(bus.events).toEqual([])
  })

  test("a blank name is refused before the write", async () => {
    const result = await lorebook.updateLorebookEntry(
      { id: ENTRY, patch: { name: " " } },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Name is required.",
    })
    expect(db.statements).toEqual([])
  })
})

describe("deleteLorebookEntry", () => {
  test("returns the owning story and the deleting clock", async () => {
    db.next([{ storyId: STORY }])
    const result = await lorebook.deleteLorebookEntry({ id: ENTRY }, CTX)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(deleteLorebookEntryOutput.parse(result.data).storyId).toBe(STORY)
    expect(bus.events).toEqual([
      expect.objectContaining({
        kind: "entity",
        op: "delete",
        id: ENTRY,
        storyId: STORY,
        version: result.data.version,
        origin: "device-a",
      }),
      { kind: "change", storyId: STORY, covered: true },
    ])
  })

  test("a missing row is not_found", async () => {
    db.next([])
    const result = await lorebook.deleteLorebookEntry({ id: ENTRY }, CTX)
    expect(result.ok || result.code).toBe("not_found")
  })
})
