// tests/api/stories-routes.test.ts — round trips through the stories route
// handlers, over the real service and bus, against a scripted drizzle chain.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import { ORIGIN_HEADER } from "@/lib/services/context"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"
import {
  storyCreatedOutput,
  storyPageOutput,
  storyWriteOutput,
} from "@/lib/services/stories.schema"
import { captureBus, installFakeDb } from "@/lib/services/test-support"

installQueryMocks()
const db = installFakeDb()
// Dynamic, so "server-only" is already doubled when respond.ts loads.
const collection = await import("@/app/api/stories/route")
const item = await import("@/app/api/stories/[storyId]/route")
const tint = await import("@/app/api/stories/[storyId]/tint/route")
const tintAuto = await import("@/app/api/stories/[storyId]/tint/auto/route")
const duplicate = await import("@/app/api/stories/[storyId]/duplicate/route")
const generationSettings =
  await import("@/app/api/stories/[storyId]/generation-settings/route")
const imageModel = await import("@/app/api/stories/[storyId]/image-model/route")

const STORY = "11111111-1111-4111-8111-111111111111"
const COPY = "33333333-3333-4333-8333-333333333333"

const ROW = {
  id: STORY,
  title: "The Long Road",
  description: "",
  genre: "",
  createdAt: "2026-09-23T00:00:00.000Z",
  updatedAt: "2026-09-23T00:00:01.000Z",
  tintHue: null,
  tintStrength: 1,
  tintAuto: true,
}

const listStories = mock(async (_options: unknown) => ({
  stories: [{ ...ROW }],
  hasMore: false,
}))

function request(
  method: string,
  body?: unknown,
  url = "http://local/api/stories"
) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", [ORIGIN_HEADER]: "phone-1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ storyId: STORY }) }

let bus: Awaited<ReturnType<typeof captureBus>>

beforeEach(async () => {
  stubQueries({
    getAppSettings: async () => ({ defaultProfileId: null }),
    listStoryRecords: async (options: { storyId?: string }) => [
      {
        id: options.storyId,
        version: ROW.updatedAt,
        row: { ...ROW, id: options.storyId, wordCount: 7 },
      },
    ],
    listStories,
  })
  listStories.mockClear()
  db.reset()
  bus = await captureBus()
})

afterEach(() => bus.stop())

describe("GET /api/stories", () => {
  test("reads the window the query string names", async () => {
    const res = await collection.GET(
      request("GET", undefined, "http://local/api/stories?offset=20&query=road")
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(storyPageOutput.parse(body.data).stories).toHaveLength(1)
    expect(listStories.mock.calls[0]?.[0]).toMatchObject({
      offset: 20,
      query: "road",
    })
  })

  test("a bad offset is a 400", async () => {
    const res = await collection.GET(
      request("GET", undefined, "http://local/api/stories?offset=abc")
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Invalid offset.")
  })
})

describe("POST /api/stories", () => {
  test("creates, answers with the id and record, stamps the origin", async () => {
    db.next([ROW])
    const res = await collection.POST(
      request("POST", { id: STORY, title: "The Long Road" })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(storyCreatedOutput.parse(body.data).id).toBe(STORY)
    expect(bus.events[0]).toMatchObject({ op: "upsert", origin: "phone-1" })
    expect(bus.events[1]).toEqual({
      kind: "change",
      storyId: null,
      covered: true,
    })
  })

  test("a malformed id is a 400", async () => {
    const res = await collection.POST(request("POST", { id: "a b" }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      ok: false,
      code: "invalid",
      error: "Invalid story id.",
    })
  })

  test("a body that is not JSON is a 400 before the service runs", async () => {
    const res = await collection.POST(
      new Request("http://local/api/stories", { method: "POST", body: "{" })
    )
    expect(res.status).toBe(400)
    expect(db.statements).toEqual([])
  })
})

describe("PATCH /api/stories/:storyId", () => {
  test("applies the body as the metadata patch", async () => {
    db.next([{ ...ROW, genre: "western" }])
    const res = await item.PATCH(request("PATCH", { genre: "western" }), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(storyWriteOutput.parse(body.data).record.genre).toBe("western")
    expect(db.argsOf(0, "set")?.[0]).toMatchObject({ genre: "western" })
  })

  test("a blank title is a 400 with the old sentence", async () => {
    const res = await item.PATCH(request("PATCH", { title: " " }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Title can't be empty.")
  })

  test("an unknown story is a 404", async () => {
    db.next([])
    const res = await item.PATCH(request("PATCH", { genre: "x" }), params)
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe("not_found")
  })
})

describe("DELETE /api/stories/:storyId", () => {
  test("deletes and publishes a library-wide removal", async () => {
    db.next([{ id: STORY }])
    const res = await item.DELETE(request("DELETE"), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: null })
    expect(bus.events[0]).toMatchObject({ op: "delete", origin: "phone-1" })
  })

  test("a story already gone is still a 200", async () => {
    db.next([])
    const res = await item.DELETE(request("DELETE"), params)
    expect(res.status).toBe(200)
    expect(bus.events).toEqual([])
  })
})

describe("PATCH /api/stories/:storyId/tint", () => {
  test("clamps and writes the tint", async () => {
    db.next([{ ...ROW, tintHue: 10 }])
    const res = await tint.PATCH(
      request("PATCH", { hue: 370, strength: -1 }),
      params
    )
    expect(res.status).toBe(200)
    expect(db.argsOf(0, "set")?.[0]).toMatchObject({
      tintHue: 10,
      tintStrength: 0,
    })
  })

  test("a missing hue is a 400", async () => {
    const res = await tint.PATCH(request("PATCH", {}), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Invalid tint hue.")
  })
})

describe("PATCH /api/stories/:storyId/tint/auto", () => {
  test("moves only the flag", async () => {
    db.next([{ ...ROW, tintAuto: false }])
    const res = await tintAuto.PATCH(request("PATCH", { auto: false }), params)
    expect(res.status).toBe(200)
    expect((await res.json()).data.record.tintAuto).toBe(false)
  })

  test("a missing flag is a 400", async () => {
    const res = await tintAuto.PATCH(request("PATCH", {}), params)
    expect(res.status).toBe(400)
  })
})

describe("POST /api/stories/:storyId/duplicate", () => {
  test("copies under the caller's id", async () => {
    db.next([{ ...ROW, undoCursor: 3 }])
    db.next([])
    db.next([])
    db.next([{ ...ROW, id: COPY }])
    const res = await duplicate.POST(request("POST", { copyId: COPY }), params)
    expect(res.status).toBe(200)
    expect(storyCreatedOutput.parse((await res.json()).data).id).toBe(COPY)
    expect(bus.events[0]).toMatchObject({ id: COPY, origin: "phone-1" })
  })

  test("an unknown source is a 404", async () => {
    db.next([])
    const res = await duplicate.POST(request("POST", {}), params)
    expect(res.status).toBe(404)
  })
})

describe("PATCH /api/stories/:storyId/generation-settings", () => {
  test("writes the patch and answers null", async () => {
    db.next([ROW])
    const res = await generationSettings.PATCH(
      request("PATCH", { temperature: 0.7 }),
      params
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: null })
    expect(bus.events[0]).toMatchObject({ op: "upsert", origin: "phone-1" })
  })

  test("a context window off the ladder is a 400", async () => {
    const res = await generationSettings.PATCH(
      request("PATCH", { contextWindow: 3 }),
      params
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Unsupported context window.")
  })
})

describe("PATCH /api/stories/:storyId/image-model", () => {
  test("writes the model", async () => {
    db.next([ROW])
    const res = await imageModel.PATCH(
      request("PATCH", { imageModelId: "img-1" }),
      params
    )
    expect(res.status).toBe(200)
    expect(db.argsOf(0, "set")?.[0]).toMatchObject({ imageModelId: "img-1" })
  })

  test("an unknown story is a 404", async () => {
    db.next([])
    const res = await imageModel.PATCH(
      request("PATCH", { imageModelId: null }),
      params
    )
    expect(res.status).toBe(404)
  })
})
