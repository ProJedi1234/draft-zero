// tests/api/images-routes.test.ts — round trips through the illustration route
// handlers, over the real service and bus, against a scripted drizzle chain.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { ORIGIN_HEADER } from "@/lib/services/context"

import { captureBus, installFakeDb } from "@/lib/services/test-support"

const db = installFakeDb()
const stop = await import("@/app/api/stories/[storyId]/illustration/stop/route")
const slot =
  await import("@/app/api/stories/[storyId]/illustrations/[imageGroupId]/route")
const restore =
  await import("@/app/api/stories/[storyId]/illustrations/[imageGroupId]/restore/route")
const select =
  await import("@/app/api/stories/[storyId]/illustrations/[imageGroupId]/select/route")
const step =
  await import("@/app/api/stories/[storyId]/illustrations/[imageGroupId]/step/route")

const STORY = "11111111-1111-4111-8111-111111111111"
const GROUP = "22222222-2222-4222-8222-222222222222"
const TAKE_B = "33333333-3333-4333-8333-333333333333"
const CHANGE = { kind: "change" as const, storyId: STORY }

function request(method: string, body?: unknown) {
  return new Request("http://local/api/stories", {
    method,
    headers: { "content-type": "application/json", [ORIGIN_HEADER]: "phone-1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const storyParams = { params: Promise.resolve({ storyId: STORY }) }
const slotParams = {
  params: Promise.resolve({ storyId: STORY, imageGroupId: GROUP }),
}

let bus: Awaited<ReturnType<typeof captureBus>>

beforeEach(async () => {
  db.reset()
  bus = await captureBus()
})

afterEach(() => bus.stop())

describe("POST /api/stories/:storyId/illustration/stop", () => {
  test("answers ok with no run to stop, with or without a runId", async () => {
    for (const body of [{}, { runId: "run-1" }, { runId: null }]) {
      const res = await stop.POST(request("POST", body), storyParams)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, data: null })
    }
  })

  test("a malformed story id is a 400", async () => {
    const res = await stop.POST(request("POST", {}), {
      params: Promise.resolve({ storyId: "not an id" }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Invalid story id.")
  })
})

describe("DELETE /api/stories/:storyId/illustrations/:imageGroupId", () => {
  test("soft-deletes the slot and publishes a story change", async () => {
    const res = await slot.DELETE(request("DELETE"), slotParams)
    expect(res.status).toBe(200)
    expect(Object.keys(db.argsOf(0, "set")?.[0] as object)).toEqual([
      "deletedAt",
    ])
    expect(bus.events).toEqual([CHANGE])
  })
})

describe("POST …/restore", () => {
  test("clears deletedAt and publishes", async () => {
    const res = await restore.POST(request("POST"), slotParams)
    expect(res.status).toBe(200)
    expect(db.argsOf(0, "set")?.[0]).toEqual({ deletedAt: null })
    expect(bus.events).toEqual([CHANGE])
  })
})

describe("POST …/select", () => {
  test("promotes the take named in the body", async () => {
    db.next([
      { id: GROUP, isActive: true },
      { id: TAKE_B, isActive: false },
    ])
    const res = await select.POST(
      request("POST", { imageId: TAKE_B }),
      slotParams
    )
    expect(res.status).toBe(200)
    expect(db.statements.map((s) => s.root)).toEqual([
      "select",
      "update",
      "update",
    ])
    expect(bus.events).toEqual([CHANGE])
  })

  test("a missing imageId is a 400", async () => {
    const res = await select.POST(request("POST", {}), slotParams)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Invalid image id.")
  })
})

describe("POST …/step", () => {
  test("steps the active take", async () => {
    db.next([
      { id: GROUP, isActive: true },
      { id: TAKE_B, isActive: false },
    ])
    const res = await step.POST(request("POST", { offset: 1 }), slotParams)
    expect(res.status).toBe(200)
    expect(db.argsOf(2, "set")?.[0]).toEqual({ isActive: true })
    expect(bus.events).toEqual([CHANGE])
  })

  test("a bad offset is a 400 with the old sentence", async () => {
    const res = await step.POST(request("POST", { offset: 3 }), slotParams)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      ok: false,
      code: "invalid",
      error: "Can only step one take at a time.",
    })
  })

  test("a body that is not JSON is a 400 before the service runs", async () => {
    const res = await step.POST(
      new Request("http://local/api/stories", { method: "POST", body: "{" }),
      slotParams
    )
    expect(res.status).toBe(400)
    expect(db.statements).toEqual([])
  })
})
