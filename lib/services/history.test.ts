// lib/services/history.test.ts — undo, redo and take switching against a
// scripted drizzle chain, the real journal (lib/db/journal.ts), the real run
// registry and the real sync bus.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { historyMoveOutput } from "@/lib/services/history.schema"
import { captureBus, installFakeDb } from "@/lib/services/test-support"

const db = installFakeDb()
const history = await import("@/lib/services/history")
const live = await import("@/lib/generation/live")

// A story id no other spec reserves, since the registry is process-global.
const STORY = "history-service-spec-story"
const CTX = { origin: "device-a" }
const RUNNING =
  "A generation is running for this story — wait for it to finish."

const RETRY_OP = {
  summary: "Retry",
  payloadJson: JSON.stringify({
    kind: "retry",
    variantGroupId: "slot-1",
    previousEntryId: "take-a",
    newEntryId: "take-b",
  }),
}

/** The `set` argument of every statement, in order. */
function sets() {
  return db.statements.map(
    (_, i) => db.argsOf(i, "set")?.[0] as Record<string, unknown> | undefined
  )
}

let bus: Awaited<ReturnType<typeof captureBus>>

beforeEach(async () => {
  db.reset()
  bus = await captureBus()
})

afterEach(() => {
  bus.stop()
  live.releaseRun(STORY)
})

const CHANGE = { kind: "change" as const, storyId: STORY }

describe("undoStoryOp", () => {
  test("reverses the op at the cursor, steps back, and commits", async () => {
    db.next([{ undoCursor: 2 }])
    db.next([RETRY_OP])
    const result = await history.undoStoryOp({ storyId: STORY }, CTX)

    expect(result).toEqual({ ok: true, data: { summary: "Retry" } })
    expect(historyMoveOutput.parse(result.ok && result.data)).toEqual({
      summary: "Retry",
    })
    expect(db.statements.map((s) => s.root)).toEqual([
      "select",
      "select",
      "update",
      "update",
      "update",
    ])
    // The cursor read locks the row; the swap deactivates before activating.
    expect(db.argsOf(0, "for")).toEqual(["update"])
    expect(sets().slice(2, 4)).toEqual([
      { isActive: false },
      { isActive: true },
    ])
    expect(sets()[4]).toMatchObject({ undoCursor: 1 })
    expect(db.revalidated).toEqual(["/"])
    expect(bus.events).toEqual([CHANGE])
  })

  test("at the start of the history is ok with null, and still commits", async () => {
    db.next([{ undoCursor: 0 }])
    const result = await history.undoStoryOp({ storyId: STORY }, CTX)
    expect(result).toEqual({ ok: true, data: null })
    expect(db.statements).toHaveLength(1)
    expect(bus.events).toEqual([CHANGE])
  })

  test("an unparseable op is an opaque wall, not an error", async () => {
    db.next([{ undoCursor: 1 }])
    db.next([{ summary: "?", payloadJson: "{" }])
    const result = await history.undoStoryOp({ storyId: STORY }, CTX)
    expect(result).toEqual({ ok: true, data: null })
    expect(db.statements).toHaveLength(2)
  })

  test("a missing story is not_found and publishes nothing", async () => {
    db.next([])
    const result = await history.undoStoryOp({ storyId: STORY }, CTX)
    expect(result).toEqual({
      ok: false,
      code: "not_found",
      error: "Story not found.",
    })
    expect(db.revalidated).toEqual([])
    expect(bus.events).toEqual([])
  })

  test("refuses during a run with a conflict, before touching the db", async () => {
    live.reserveRun(STORY)
    const result = await history.undoStoryOp({ storyId: STORY }, CTX)
    expect(result).toEqual({ ok: false, code: "conflict", error: RUNNING })
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([])
  })

  test("rejects a malformed story id", async () => {
    const result = await history.undoStoryOp({ storyId: "a b" }, CTX)
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Invalid story id.",
    })
    expect(db.statements).toEqual([])
  })
})

describe("redoStoryOp", () => {
  test("reapplies the op above the cursor and steps forward", async () => {
    db.next([{ undoCursor: 1 }])
    db.next([RETRY_OP])
    const result = await history.redoStoryOp({ storyId: STORY }, CTX)

    expect(result).toEqual({ ok: true, data: { summary: "Retry" } })
    expect(sets().slice(2, 4)).toEqual([
      { isActive: false },
      { isActive: true },
    ])
    expect(sets()[4]).toMatchObject({ undoCursor: 2 })
    expect(bus.events).toEqual([CHANGE])
  })

  test("nothing above the cursor is ok with null", async () => {
    db.next([{ undoCursor: 3 }])
    db.next([])
    const result = await history.redoStoryOp({ storyId: STORY }, CTX)
    expect(result).toEqual({ ok: true, data: null })
    expect(bus.events).toEqual([CHANGE])
  })

  test("a missing story is not_found", async () => {
    db.next([])
    const result = await history.redoStoryOp({ storyId: STORY }, CTX)
    expect(result.ok || result.code).toBe("not_found")
    expect(bus.events).toEqual([])
  })

  test("refuses during a run with a conflict", async () => {
    live.reserveRun(STORY)
    const result = await history.redoStoryOp({ storyId: STORY }, CTX)
    expect(result).toEqual({ ok: false, code: "conflict", error: RUNNING })
    expect(db.statements).toEqual([])
  })
})

describe("selectVariantByOffset", () => {
  const input = { storyId: STORY, entryId: "take-a", offset: 1 }

  function scriptSlot(lastPosition = 4) {
    db.next([{ variantGroupId: "slot-1", position: 4 }])
    db.next([{ position: lastPosition }])
    db.next([
      { id: "take-a", isActive: true },
      { id: "take-b", isActive: false },
    ])
  }

  test("switches to the next take, records the switch, and commits", async () => {
    scriptSlot()
    db.next([]) // applyMutations: deactivate take-a
    db.next([]) // applyMutations: activate take-b
    db.next([{ undoCursor: 5 }]) // recordOp's locked cursor read
    const result = await history.selectVariantByOffset(input, CTX)

    expect(result).toEqual({ ok: true, data: { summary: "Switch take" } })
    expect(db.statements.map((s) => s.root)).toEqual([
      "select",
      "select",
      "select",
      "update",
      "update",
      "select",
      "delete",
      "insert",
      "update",
      "update",
    ])
    expect(sets().slice(3, 5)).toEqual([
      { isActive: false },
      { isActive: true },
    ])
    const op = db.argsOf(7, "values")?.[0] as Record<string, unknown>
    expect(op).toMatchObject({
      storyId: STORY,
      seq: 6,
      kind: "switch-take",
      summary: "Switch take",
    })
    expect(JSON.parse(op.payloadJson as string)).toEqual({
      kind: "switch-take",
      variantGroupId: "slot-1",
      fromEntryId: "take-a",
      toEntryId: "take-b",
    })
    expect(sets()[8]).toEqual({ undoCursor: 6 })
    expect(Object.keys(sets()[9] ?? {})).toEqual(["updatedAt"])
    expect(db.revalidated).toEqual(["/"])
    expect(bus.events).toEqual([CHANGE])
  })

  test("off either end is ok with null and writes nothing", async () => {
    scriptSlot()
    const result = await history.selectVariantByOffset(
      { ...input, offset: -1 },
      CTX
    )
    expect(result).toEqual({ ok: true, data: null })
    expect(db.statements).toHaveLength(3)
  })

  test("an older passage cannot switch takes", async () => {
    scriptSlot(9)
    const result = await history.selectVariantByOffset(input, CTX)
    expect(result).toEqual({
      ok: false,
      code: "conflict",
      error: "Only the newest passage can switch between takes.",
    })
    expect(bus.events).toEqual([])
  })

  test("an unknown passage is not_found", async () => {
    db.next([])
    const result = await history.selectVariantByOffset(input, CTX)
    expect(result).toEqual({
      ok: false,
      code: "not_found",
      error: "Passage not found.",
    })
    expect(bus.events).toEqual([])
  })

  test("a slot with no active take is not_found", async () => {
    db.next([{ variantGroupId: "slot-1", position: 4 }])
    db.next([{ position: 4 }])
    db.next([{ id: "take-a", isActive: false }])
    const result = await history.selectVariantByOffset(input, CTX)
    expect(result.ok || result.code).toBe("not_found")
  })

  test("refuses during a run with a conflict", async () => {
    live.reserveRun(STORY)
    const result = await history.selectVariantByOffset(input, CTX)
    expect(result).toEqual({ ok: false, code: "conflict", error: RUNNING })
    expect(db.statements).toEqual([])
  })

  test("rejects malformed input with its sentences", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...input, storyId: "a b" }, "Invalid story id."],
      [{ ...input, entryId: "a b" }, "Invalid entry id."],
      [{ ...input, offset: 0.5 }, "Invalid offset."],
      [{ ...input, offset: "1" }, "Invalid offset."],
    ]
    for (const [raw, error] of cases) {
      const result = await history.selectVariantByOffset(raw as never, CTX)
      expect(result).toEqual({ ok: false, code: "invalid", error })
    }
    expect(db.statements).toEqual([])
  })
})
