// tests/api/history-routes.test.ts — round trips through the undo, redo and
// variant routes, over the real service, journal and bus, against a scripted
// drizzle chain.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { ORIGIN_HEADER } from "@/lib/services/context"

import { historyMoveOutput } from "@/lib/services/history.schema"
import { captureBus, installFakeDb } from "@/lib/services/test-support"

const db = installFakeDb()
// After installFakeDb: respond.ts imports server-only, which throws unless doubled.
const undo = await import("@/app/api/stories/[storyId]/undo/route")
const redo = await import("@/app/api/stories/[storyId]/redo/route")
const variant = await import("@/app/api/stories/[storyId]/variant/route")
const live = await import("@/lib/generation/live")

// A story id no other spec reserves, since the registry is process-global.
const STORY = "history-routes-spec-story"
const params = { params: Promise.resolve({ storyId: STORY }) }

const RETRY_OP = {
  summary: "Retry",
  payloadJson: JSON.stringify({
    kind: "retry",
    variantGroupId: "slot-1",
    previousEntryId: "take-a",
    newEntryId: "take-b",
  }),
}

function post(verb: string, body?: unknown) {
  return new Request(`http://local/api/stories/${STORY}/${verb}`, {
    method: "POST",
    headers: { "content-type": "application/json", [ORIGIN_HEADER]: "phone-1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
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

describe("POST /api/stories/:storyId/undo", () => {
  test("undoes the op at the cursor and answers its summary", async () => {
    db.next([{ undoCursor: 1 }])
    db.next([RETRY_OP])
    const res = await undo.POST(post("undo"), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(historyMoveOutput.parse(body.data)).toEqual({ summary: "Retry" })
    expect(bus.events).toEqual([{ kind: "change" as const, storyId: STORY }])
  })

  test("a run in flight is a 409", async () => {
    live.reserveRun(STORY)
    const res = await undo.POST(post("undo"), params)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("conflict")
    expect(db.statements).toEqual([])
  })

  test("a missing story is a 404", async () => {
    db.next([])
    const res = await undo.POST(post("undo"), params)
    expect(res.status).toBe(404)
  })
})

describe("POST /api/stories/:storyId/redo", () => {
  test("nothing to redo is a 200 with null", async () => {
    db.next([{ undoCursor: 1 }])
    db.next([])
    const res = await redo.POST(post("redo"), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: null })
  })
})

describe("POST /api/stories/:storyId/variant", () => {
  test("switches the take the body names", async () => {
    db.next([{ variantGroupId: "slot-1", position: 2 }])
    db.next([{ position: 2 }])
    db.next([
      { id: "take-a", isActive: false },
      { id: "take-b", isActive: true },
    ])
    db.next([])
    db.next([])
    db.next([{ undoCursor: 0 }])
    const res = await variant.POST(
      post("variant", { entryId: "take-b", offset: -1 }),
      params
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ summary: "Switch take" })
    expect(bus.events).toEqual([{ kind: "change" as const, storyId: STORY }])
  })

  test("a bad offset is a 400 before any read", async () => {
    const res = await variant.POST(
      post("variant", { entryId: "take-b", offset: 1.5 }),
      params
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      ok: false,
      code: "invalid",
      error: "Invalid offset.",
    })
    expect(db.statements).toEqual([])
  })

  test("a body that is not JSON is a 400", async () => {
    const res = await variant.POST(
      new Request("http://local/x", { method: "POST", body: "{" }),
      params
    )
    expect(res.status).toBe(400)
  })
})
