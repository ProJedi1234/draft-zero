import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { captureBus, installFakeDb } from "@/lib/services/test-support"
import { NO_ORIGIN } from "@/lib/services/context"

const db = installFakeDb()
const { applyWorldPatch, getWorldState } = await import("./world")
const { reserveRun, releaseRun } = await import("@/lib/generation/live")
const STORY = "world-service-tests"
const NPC = {
  id: "npc",
  storyId: STORY,
  name: "Vell",
  category: "character",
  npc: true,
  keysJson: '["vell"]',
  content: "A sailor",
  enabled: true,
  alwaysActive: false,
  priority: 50,
  createdAt: "0",
  updatedAt: "0",
}
let bus: Awaited<ReturnType<typeof captureBus>>
beforeEach(async () => {
  db.reset()
  bus = await captureBus()
})
afterEach(() => {
  releaseRun(STORY)
  bus.stop()
})
function script(entries: unknown[] = []) {
  db.next([{ id: STORY }])
  db.next(entries)
  db.next([NPC])
  db.next([])
}
const set = { type: "set-clock" as const, minutes: 30 }

describe("world service", () => {
  test("reads every opted-in NPC without publishing", async () => {
    script()
    const result = await getWorldState({ storyId: STORY }, NO_ORIGIN)
    expect(result).toEqual({
      ok: true,
      data: {
        state: {
          storyId: STORY,
          minutes: 0,
          npcs: [{ loreEntryId: "npc", name: "Vell", mind: "", memories: [] }],
        },
      },
    })
    expect(bus.events).toEqual([])
  })
  test("manual corrections before any passage keep a null memory anchor", async () => {
    script()
    const result = await applyWorldPatch(
      {
        storyId: STORY,
        ops: [
          set,
          {
            type: "add-memory",
            loreEntryId: "npc",
            memory: { id: "memory", text: "I saw the bell.", importance: 2 },
          },
        ],
      },
      NO_ORIGIN
    )
    expect(result.ok && result.data.state.npcs[0].memories[0]).toMatchObject({
      minutes: 30,
      entryId: null,
    })
    expect(db.argsOf(4, "values")?.[0]).toMatchObject({
      source: "manual",
      entryId: null,
    })
    expect(bus.events).toEqual([{ kind: "change", storyId: STORY }])
    expect(db.revalidated).toEqual(["/"])
  })
  test("anchors only to the latest live generated passage", async () => {
    script([
      {
        id: "old",
        position: 1,
        isActive: true,
        deletedAt: null,
        source: "generated",
      },
      {
        id: "new",
        position: 3,
        isActive: true,
        deletedAt: null,
        source: "generated",
      },
      {
        id: "user",
        position: 4,
        isActive: true,
        deletedAt: null,
        source: "user",
      },
      {
        id: "inactive",
        position: 5,
        isActive: false,
        deletedAt: null,
        source: "generated",
      },
      {
        id: "deleted",
        position: 6,
        isActive: true,
        deletedAt: "x",
        source: "generated",
      },
    ])
    const result = await applyWorldPatch(
      { storyId: STORY, ops: [set] },
      NO_ORIGIN
    )
    expect(result.ok && result.data.state.minutes).toBe(30)
    expect(db.argsOf(4, "values")?.[0]).toMatchObject({ entryId: "new" })
  })
  test("refuses a live run before writing", async () => {
    expect(reserveRun(STORY)).toBe(true)
    expect(
      await applyWorldPatch({ storyId: STORY, ops: [set] }, NO_ORIGIN)
    ).toMatchObject({ ok: false, code: "conflict" })
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([])
  })
  test("missing stories produce not_found on read and write", async () => {
    expect(await getWorldState({ storyId: STORY }, NO_ORIGIN)).toMatchObject({
      code: "not_found",
    })
    expect(
      await applyWorldPatch({ storyId: STORY, ops: [set] }, NO_ORIGIN)
    ).toMatchObject({ code: "not_found" })
    expect(bus.events).toEqual([])
  })
  test("validates ids, operations and bounds before any database access", async () => {
    expect(await getWorldState({ storyId: "../" }, NO_ORIGIN)).toMatchObject({
      code: "invalid",
      error: "Invalid story id.",
    })
    for (const ops of [
      [],
      [{ type: "advance-clock", minutes: 1 }],
      [{ type: "set-clock", minutes: -1 }],
      [{ type: "set-clock", minutes: 1.5 }],
      [{ type: "set-mind", loreEntryId: "npc", mind: "x".repeat(281) }],
      [
        {
          type: "add-memory",
          loreEntryId: "npc",
          memory: { id: "m", text: "", importance: 8 },
        },
      ],
    ]) {
      expect(
        await applyWorldPatch(
          { storyId: STORY, ops } as Parameters<typeof applyWorldPatch>[0],
          NO_ORIGIN
        )
      ).toMatchObject({ code: "invalid" })
    }
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([])
  })
  test("refuses ops that name a missing NPC, a missing memory or a used id", async () => {
    const memory = {
      type: "add-memory" as const,
      loreEntryId: "npc",
      memory: { id: "m1", text: "I saw the bell.", importance: 2 },
    }
    for (const ops of [
      [{ type: "set-mind" as const, loreEntryId: "ghost", mind: "Hm." }],
      [{ type: "strike-memory" as const, loreEntryId: "npc", memoryId: "m9" }],
      [memory, memory],
    ]) {
      db.reset()
      script()
      expect(
        await applyWorldPatch({ storyId: STORY, ops }, NO_ORIGIN)
      ).toMatchObject({ ok: false, code: "invalid" })
    }
    expect(bus.events).toEqual([])
  })
})
