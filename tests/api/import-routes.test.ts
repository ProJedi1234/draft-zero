// tests/api/import-routes.test.ts — round trips through the import route
// handlers, over the real services, parsers and bus, against a scripted
// drizzle chain.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { ORIGIN_HEADER } from "@/lib/services/context"

import { MAX_BACKUP_BYTES } from "@/lib/import/aidungeon-backup"
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
// respond.ts imports server-only, so it loads after the fake that doubles it.
const scenarioRoute = await import("@/app/api/import/scenario/route")
const cardsRoute = await import("@/app/api/import/story-cards/route")
const backupRoute = await import("@/app/api/import/backup/route")
const mergeRoute = await import("@/app/api/stories/[storyId]/story-cards/route")

const STORY = "11111111-1111-4111-8111-111111111111"
const PROFILE = "33333333-3333-4333-8333-333333333333"

const CARDS = JSON.stringify([
  { keys: "Decsos", value: "A town.", type: "location", title: "Decsos" },
])
const SCENARIO = JSON.stringify({ title: "Decsos", prompt: "You wake." })
const BACKUP_PATH = new URL("../fixtures/aidungeon-backup.zip", import.meta.url)
  .pathname

function post(path: string, body: BodyInit, headers: HeadersInit = {}) {
  return new Request(`http://local${path}`, {
    method: "POST",
    headers: { [ORIGIN_HEADER]: "phone-1", ...headers },
    body,
  })
}

function postJson(path: string, body: unknown) {
  return post(path, JSON.stringify(body), {
    "content-type": "application/json",
  })
}

const params = { params: Promise.resolve({ storyId: STORY }) }

let bus: Awaited<ReturnType<typeof captureBus>>

beforeEach(async () => {
  db.reset()
  stubQueries({
    getAppSettings: async () => ({ defaultProfileId: PROFILE }),
  })
  bus = await captureBus()
})

afterEach(() => bus.stop())

describe("POST /api/import/scenario", () => {
  test("imports and answers with the summary", async () => {
    const res = await scenarioRoute.POST(
      postJson("/api/import/scenario", { json: SCENARIO })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(scenarioImportOutput.parse(body.data).title).toBe("Decsos")
    expect(bus.events).toEqual([{ kind: "change", storyId: null }])
  })

  test("a file the reader refuses is a 400 with its sentence", async () => {
    const res = await scenarioRoute.POST(
      postJson("/api/import/scenario", { json: "{" })
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      ok: false,
      code: "invalid",
      error: "That file isn't valid JSON.",
    })
  })

  test("a body that is not JSON is a 400 before the service runs", async () => {
    const res = await scenarioRoute.POST(post("/api/import/scenario", "{"))
    expect(res.status).toBe(400)
    expect(db.statements).toEqual([])
  })
})

describe("POST /api/import/story-cards", () => {
  test("imports and answers with the summary", async () => {
    const res = await cardsRoute.POST(
      postJson("/api/import/story-cards", { json: CARDS })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(storyCardImportOutput.parse(body.data).lorebookEntryCount).toBe(1)
  })

  test("a missing file is a 400", async () => {
    const res = await cardsRoute.POST(postJson("/api/import/story-cards", {}))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(
      "That import didn't arrive as a file."
    )
  })
})

describe("POST /api/import/backup", () => {
  test("takes the raw zip as the body", async () => {
    const bytes = await Bun.file(BACKUP_PATH).arrayBuffer()
    const res = await backupRoute.POST(
      post("/api/import/backup", bytes, { "content-type": "application/zip" })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(backupImportOutput.parse(body.data).passageCount).toBeGreaterThan(0)
    expect(bus.events).toEqual([{ kind: "change", storyId: null }])
  })

  test("an oversized declared length is refused before the body is read", async () => {
    const res = await backupRoute.POST(
      post("/api/import/backup", "x", {
        "content-length": String(MAX_BACKUP_BYTES + 1),
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("That backup is too large to import.")
    expect(db.statements).toEqual([])
  })

  test("an oversized chunked body is refused before it is drained", async () => {
    const chunk = new Uint8Array(1024 * 1024)
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled > MAX_BACKUP_BYTES * 2) return controller.close()
        pulled += chunk.byteLength
        controller.enqueue(chunk)
      },
    })
    const res = await backupRoute.POST(
      new Request("http://local/api/import/backup", {
        method: "POST",
        body,
        duplex: "half",
      } as RequestInit)
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("That backup is too large to import.")
    expect(pulled).toBeLessThan(MAX_BACKUP_BYTES * 2)
    expect(db.statements).toEqual([])
  })
})

describe("POST /api/stories/:storyId/story-cards", () => {
  test("merges into the story named by the path", async () => {
    db.next([{ id: STORY }])
    db.next([])
    const res = await mergeRoute.POST(
      postJson(`/api/stories/${STORY}/story-cards`, { json: CARDS }),
      params
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(storyCardMergeOutput.parse(body.data)).toMatchObject({
      storyId: STORY,
      lorebookEntryCount: 1,
    })
    expect(bus.events).toEqual([
      { kind: "change", storyId: STORY, entities: ["lorebook-entry"] },
    ])
  })

  test("an unknown story is a 404", async () => {
    db.next([])
    const res = await mergeRoute.POST(
      postJson(`/api/stories/${STORY}/story-cards`, { json: CARDS }),
      params
    )
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe("not_found")
  })
})
