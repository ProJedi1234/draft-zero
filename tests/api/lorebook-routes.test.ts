// tests/api/lorebook-routes.test.ts — round trips through the lorebook route
// handlers, over the real service and bus, against a scripted drizzle chain.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { ORIGIN_HEADER } from "@/lib/services/context"
import {
  deleteLorebookEntryOutput,
  lorebookEntryWriteOutput,
} from "@/lib/services/lorebook.schema"
import { captureBus, installFakeDb } from "@/lib/services/test-support"

const db = installFakeDb()
const collection = await import("@/app/api/lorebook/route")
const item = await import("@/app/api/lorebook/[entryId]/route")

const STORY = "11111111-1111-4111-8111-111111111111"
const ENTRY = "22222222-2222-4222-8222-222222222222"

const ROW = {
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
}

function request(method: string, body?: unknown, origin = "phone-1") {
  return new Request("http://local/api/lorebook", {
    method,
    headers: { "content-type": "application/json", [ORIGIN_HEADER]: origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ entryId: ENTRY }) }

let bus: Awaited<ReturnType<typeof captureBus>>

beforeEach(async () => {
  db.reset()
  bus = await captureBus()
})

afterEach(() => bus.stop())

describe("POST /api/lorebook", () => {
  test("creates, answers with the record, and stamps the caller's origin", async () => {
    db.next([ROW])
    const res = await collection.POST(
      request("POST", { storyId: STORY, id: ENTRY, name: "Vell" })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(lorebookEntryWriteOutput.parse(body.data).record.name).toBe("Vell")
    expect(bus.events[0]).toMatchObject({ op: "upsert", origin: "phone-1" })
  })

  test("a schema failure is a 400 with the service's code and sentence", async () => {
    const res = await collection.POST(request("POST", { storyId: STORY }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      ok: false,
      code: "invalid",
      error: "Name is required.",
    })
  })

  test("a body that is not JSON is a 400 before the service runs", async () => {
    const res = await collection.POST(
      new Request("http://local/api/lorebook", { method: "POST", body: "{" })
    )
    expect(res.status).toBe(400)
    expect(db.statements).toEqual([])
  })

  test("a JSON body that is not an object is a 400 before the service runs", async () => {
    for (const body of ["null", "[]", '"Vell"']) {
      const res = await collection.POST(
        new Request("http://local/api/lorebook", { method: "POST", body })
      )
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe(
        "The request body must be a JSON object."
      )
    }
    expect(db.statements).toEqual([])
  })
})

describe("PATCH /api/lorebook/:entryId", () => {
  test("applies the body as the patch", async () => {
    db.next([{ ...ROW, content: "Changed." }])
    const res = await item.PATCH(
      request("PATCH", { content: "Changed." }),
      params
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data.record.content).toBe("Changed.")
    expect(db.argsOf(0, "set")?.[0]).toMatchObject({ content: "Changed." })
  })

  test("an unknown entry is a 404", async () => {
    db.next([])
    const res = await item.PATCH(request("PATCH", { content: "x" }), params)
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe("not_found")
  })
})

describe("DELETE /api/lorebook/:entryId", () => {
  test("deletes and answers with the owning story and version", async () => {
    db.next([{ storyId: STORY }])
    const res = await item.DELETE(request("DELETE"), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(deleteLorebookEntryOutput.parse(body.data).storyId).toBe(STORY)
    expect(bus.events[0]).toMatchObject({ op: "delete", origin: "phone-1" })
  })
})
