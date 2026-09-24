// lib/services/images.test.ts — the illustration service against a scripted
// drizzle chain and the real sync bus. No live DB, no HTTP.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { captureBus, installFakeDb } from "@/lib/services/test-support"

const db = installFakeDb()
const images = await import("@/lib/services/images")

const STORY = "11111111-1111-4111-8111-111111111111"
const GROUP = "22222222-2222-4222-8222-222222222222"
const TAKE_B = "33333333-3333-4333-8333-333333333333"
const TAKE_C = "44444444-4444-4444-8444-444444444444"
const CTX = { origin: "device-a" }

const CHANGE = { kind: "change" as const, storyId: STORY }

let bus: Awaited<ReturnType<typeof captureBus>>

beforeEach(async () => {
  db.reset()
  bus = await captureBus()
})

afterEach(() => bus.stop())

describe("stopIllustration", () => {
  test("is a no-op success when nothing is drawing", async () => {
    const result = await images.stopIllustration(
      { storyId: STORY, runId: "run-1" },
      CTX
    )
    expect(result).toEqual({ ok: true, data: null })
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([])
  })

  test("aborts the named run and spares a later one", async () => {
    // The registry lives on globalThis, so a planted run is one the real
    // stopImageRun finds without launching a draw.
    const registry = (
      globalThis as unknown as {
        __draftZeroImageLive: { active: Map<string, unknown> }
      }
    ).__draftZeroImageLive
    const upstream = new AbortController()
    registry.active.set(STORY, { runId: "run-2", storyId: STORY, upstream })
    try {
      await images.stopIllustration({ storyId: STORY, runId: "run-1" }, CTX)
      expect(upstream.signal.aborted).toBe(false)
      await images.stopIllustration({ storyId: STORY, runId: "run-2" }, CTX)
      expect(upstream.signal.aborted).toBe(true)
    } finally {
      registry.active.delete(STORY)
    }
  })

  test("rejects a malformed story id", async () => {
    const result = await images.stopIllustration(
      { storyId: "not an id", runId: null },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Invalid story id.",
    })
  })
})

describe.each([
  ["deleteIllustration", "deletedAt", "string"],
  ["restoreIllustration", "deletedAt", "null"],
] as const)("%s", (name, column, kind) => {
  const run = (input: Record<string, unknown>) =>
    images[name](input as never, CTX)

  test("writes one UPDATE over the slot and publishes a story change", async () => {
    const result = await run({ storyId: STORY, imageGroupId: GROUP })
    expect(result).toEqual({ ok: true, data: null })
    expect(db.statements.map((s) => s.root)).toEqual(["update"])
    const set = db.argsOf(0, "set")?.[0] as Record<string, unknown>
    expect(Object.keys(set)).toEqual([column])
    expect(set[column] === null ? "null" : typeof set[column]).toBe(kind)
    expect(db.revalidated).toEqual(["/"])
    expect(bus.events).toEqual([CHANGE])
  })

  test("rejects malformed ids in order, before any write", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ storyId: "bad id", imageGroupId: "bad id" }, "Invalid story id."],
      [{ storyId: STORY, imageGroupId: "bad id" }, "Invalid illustration id."],
    ]
    for (const [input, error] of cases) {
      expect(await run(input)).toEqual({ ok: false, code: "invalid", error })
    }
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([])
  })
})

describe("selectImageById", () => {
  test("clears the slot, activates the take, and publishes", async () => {
    db.next([
      { id: GROUP, isActive: true },
      { id: TAKE_B, isActive: false },
    ])
    const result = await images.selectImageById(
      { storyId: STORY, imageGroupId: GROUP, imageId: TAKE_B },
      CTX
    )
    expect(result).toEqual({ ok: true, data: null })
    expect(db.statements.map((s) => s.root)).toEqual([
      "select",
      "update",
      "update",
    ])
    expect(db.argsOf(1, "set")?.[0]).toEqual({ isActive: false })
    expect(db.argsOf(2, "set")?.[0]).toEqual({ isActive: true })
    expect(bus.events).toEqual([CHANGE])
  })

  test("an already-active or unknown take writes and publishes nothing", async () => {
    for (const imageId of [GROUP, TAKE_C]) {
      db.reset()
      db.next([
        { id: GROUP, isActive: true },
        { id: TAKE_B, isActive: false },
      ])
      const result = await images.selectImageById(
        { storyId: STORY, imageGroupId: GROUP, imageId },
        CTX
      )
      expect(result).toEqual({ ok: true, data: null })
      expect(db.statements.map((s) => s.root)).toEqual(["select"])
    }
    expect(bus.events).toEqual([])
  })

  test("rejects malformed ids in order", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [
        { storyId: "x y", imageGroupId: GROUP, imageId: TAKE_B },
        "Invalid story id.",
      ],
      [
        { storyId: STORY, imageGroupId: "x y", imageId: TAKE_B },
        "Invalid illustration id.",
      ],
      [
        { storyId: STORY, imageGroupId: GROUP, imageId: "x y" },
        "Invalid image id.",
      ],
    ]
    for (const [input, error] of cases) {
      const result = await images.selectImageById(input as never, CTX)
      expect(result).toEqual({ ok: false, code: "invalid", error })
    }
    expect(db.statements).toEqual([])
  })
})

describe("selectImageByOffset", () => {
  const takes = [
    { id: GROUP, isActive: false },
    { id: TAKE_B, isActive: true },
    { id: TAKE_C, isActive: false },
  ]

  test("moves the active flag one take over and publishes", async () => {
    db.next(takes)
    const result = await images.selectImageByOffset(
      { storyId: STORY, imageGroupId: GROUP, offset: 1 },
      CTX
    )
    expect(result).toEqual({ ok: true, data: null })
    expect(db.statements.map((s) => s.root)).toEqual([
      "select",
      "update",
      "update",
    ])
    expect(db.statements[0].calls.map((c) => c.method)).toContain("orderBy")
    expect(db.argsOf(1, "set")?.[0]).toEqual({ isActive: false })
    expect(db.argsOf(2, "set")?.[0]).toEqual({ isActive: true })
    expect(bus.events).toEqual([CHANGE])
  })

  test("clamps at the ends: no write, no event", async () => {
    db.next([takes[1], { ...takes[2] }])
    const result = await images.selectImageByOffset(
      { storyId: STORY, imageGroupId: GROUP, offset: -1 },
      CTX
    )
    expect(result).toEqual({ ok: true, data: null })
    expect(db.statements.map((s) => s.root)).toEqual(["select"])
    expect(bus.events).toEqual([])
  })

  test("refuses anything but one step, ahead of the ids", async () => {
    for (const offset of [0, 2, -2, "1"]) {
      const result = await images.selectImageByOffset(
        { storyId: "bad id", imageGroupId: GROUP, offset } as never,
        CTX
      )
      expect(result).toEqual({
        ok: false,
        code: "invalid",
        error: "Can only step one take at a time.",
      })
    }
    expect(db.statements).toEqual([])
  })

  test("rejects a malformed story id", async () => {
    const result = await images.selectImageByOffset(
      { storyId: "bad id", imageGroupId: GROUP, offset: 1 },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Invalid story id.",
    })
  })
})
