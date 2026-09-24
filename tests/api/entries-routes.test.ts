// tests/api/entries-routes.test.ts — round trips through the entries route
// handlers, over the real service, journal and bus, against a scripted
// drizzle chain.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { ORIGIN_HEADER } from "@/lib/services/context"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"
import { installEntriesDoubles } from "@/lib/services/entries-test-support"
import {
  appendEntryOutput,
  olderEntriesPageOutput,
} from "@/lib/services/entries.schema"
import { captureBus } from "@/lib/services/test-support"

const db = await installEntriesDoubles()
installQueryMocks()
// Imported after the doubles: respond.ts pulls in "server-only".
const collection = await import("@/app/api/entries/route")
const item = await import("@/app/api/entries/[entryId]/route")
const action = await import("@/app/api/entries/[entryId]/action/route")
const rewind = await import("@/app/api/entries/[entryId]/rewind/route")
const context = await import("@/app/api/entries/[entryId]/context/route")
const { releaseRun, reserveRun } = await import("@/lib/generation/live")

// Its own id: a story another spec deleted is tombstoned in the shared run
// registry, and reserveRun would silently refuse it.
const STORY = "entries-routes-spec-story"
const ENTRY = "22222222-2222-4222-8222-222222222222"

function request(
  method: string,
  body?: unknown,
  url = "http://local/api/entries"
) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", [ORIGIN_HEADER]: "phone-1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ entryId: ENTRY }) }

let bus: Awaited<ReturnType<typeof captureBus>>

beforeEach(async () => {
  db.reset()
  stubQueries({})
  bus = await captureBus()
})

afterEach(() => {
  bus.stop()
  releaseRun(STORY)
})

describe("POST /api/entries", () => {
  test("appends narration, answers with the entry, and commits", async () => {
    db.next([{ id: STORY }])
    db.next([{ max: 2 }])
    db.next([{ max: null }])
    const res = await collection.POST(
      request("POST", { storyId: STORY, mode: "narration", text: "Rain." })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(appendEntryOutput.parse(body.data).entry).toMatchObject({
      position: 3,
      text: "Rain.",
    })
    expect(db.revalidated).toEqual(["/"])
    expect(bus.events).toEqual([{ kind: "change", storyId: STORY }])
  })

  test("a run holding the story is a 409 and nothing is written", async () => {
    expect(reserveRun(STORY)).toBe(true)
    const res = await collection.POST(
      request("POST", { storyId: STORY, mode: "narration", text: "Rain." })
    )
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("conflict")
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([])
  })

  test("a missing story is a 404 and publishes nothing", async () => {
    db.next([])
    const res = await collection.POST(
      request("POST", { storyId: STORY, mode: "say", text: "hello" })
    )
    expect(res.status).toBe(404)
    expect(bus.events).toEqual([])
  })

  test("a body that is not JSON is a 400 before the service runs", async () => {
    const res = await collection.POST(
      new Request("http://local/api/entries", { method: "POST", body: "{" })
    )
    expect(res.status).toBe(400)
    expect(db.statements).toEqual([])
  })
})

describe("GET /api/entries", () => {
  test("pages older passages from the query string", async () => {
    const page = { entries: [], windowStartPosition: null, hasMore: false }
    const calls: unknown[][] = []
    stubQueries({
      listOlderEntries: async (...args: unknown[]) => {
        calls.push(args)
        return page
      },
    })
    const res = await collection.GET(
      request(
        "GET",
        undefined,
        `http://local/api/entries?storyId=${STORY}&beforePosition=30&limit=10`
      )
    )
    expect(res.status).toBe(200)
    expect(olderEntriesPageOutput.parse((await res.json()).data)).toEqual(page)
    expect(calls).toEqual([[STORY, 30, 10]])
  })

  test("a missing position is a 400 with the service's sentence", async () => {
    const res = await collection.GET(
      request("GET", undefined, `http://local/api/entries?storyId=${STORY}`)
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      ok: false,
      code: "invalid",
      error: "Invalid position.",
    })
  })
})

describe("PATCH /api/entries/:entryId", () => {
  test("rewrites the prose and stamps the change", async () => {
    db.next([{ text: "Old.", actionKind: null, inputText: null }])
    db.next([{ id: ENTRY }])
    const res = await item.PATCH(
      request("PATCH", { storyId: STORY, text: "New." }),
      params
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: null })
    expect(db.argsOf(1, "set")?.[0]).toMatchObject({ text: "New." })
    expect(bus.events).toEqual([{ kind: "change", storyId: STORY }])
  })

  test("blank text is a 400", async () => {
    const res = await item.PATCH(
      request("PATCH", { storyId: STORY, text: " " }),
      params
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("A passage can't be empty.")
  })
})

describe("DELETE /api/entries/:entryId", () => {
  test("soft-deletes and commits", async () => {
    db.next([{ id: ENTRY }])
    const res = await item.DELETE(request("DELETE", { storyId: STORY }), params)
    expect(res.status).toBe(200)
    expect(db.argsOf(0, "set")?.[0]).toEqual({ deletedAt: expect.any(String) })
    expect(bus.events).toEqual([{ kind: "change", storyId: STORY }])
  })

  test("an already-deleted passage is a 404", async () => {
    db.next([])
    const res = await item.DELETE(request("DELETE", { storyId: STORY }), params)
    expect(res.status).toBe(404)
  })
})

describe("POST /api/entries/:entryId/action", () => {
  test("re-voices the turn", async () => {
    db.next([{ text: "You say hi.", actionKind: "say", inputText: "hi" }])
    db.next([{ id: ENTRY }])
    const res = await action.POST(
      request("POST", { storyId: STORY, rawText: "wave", kind: "do" }),
      params
    )
    expect(res.status).toBe(200)
    expect(db.argsOf(1, "set")?.[0]).toMatchObject({
      actionKind: "do",
      inputText: "wave",
    })
    expect(bus.events).toEqual([{ kind: "change", storyId: STORY }])
  })

  test("an unknown kind is a 400", async () => {
    const res = await action.POST(
      request("POST", { storyId: STORY, rawText: "wave", kind: "shout" }),
      params
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Unknown action kind.")
  })
})

describe("POST /api/entries/:entryId/rewind", () => {
  test("cuts the tail and commits", async () => {
    db.next([{ position: 2 }])
    db.next([{ id: "e3" }])
    const res = await rewind.POST(request("POST", { storyId: STORY }), params)
    expect(res.status).toBe(200)
    expect(bus.events).toEqual([{ kind: "change", storyId: STORY }])
  })

  test("nothing after the passage is a 409", async () => {
    db.next([{ position: 2 }])
    db.next([])
    const res = await rewind.POST(request("POST", { storyId: STORY }), params)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("There's nothing after this passage.")
  })
})

describe("GET /api/entries/:entryId/context", () => {
  test("a missing story is a 404", async () => {
    const res = await context.GET(
      request(
        "GET",
        undefined,
        `http://local/api/entries/${ENTRY}/context?storyId=${STORY}`
      ),
      params
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe("Story not found.")
  })

  test("a missing storyId is a 400", async () => {
    const res = await context.GET(
      request("GET", undefined, `http://local/api/entries/${ENTRY}/context`),
      params
    )
    expect(res.status).toBe(400)
  })
})
