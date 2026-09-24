// tests/api/settings-routes.test.ts — round trips through the settings route
// handlers, over the real service and bus, against a scripted drizzle chain.
// The OpenRouter call is doubled below the service; nothing leaves the process.
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test"

import { ORIGIN_HEADER } from "@/lib/services/context"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"
import { verifyOpenRouterKeyOutput } from "@/lib/services/settings.schema"
import { captureBus, installFakeDb } from "@/lib/services/test-support"

const db = installFakeDb()
installQueryMocks()

// Restores the real env read over any other spec's double of this module.
mock.module("@/lib/generation/key", () => ({
  resolveOpenRouterKey: () => process.env.OPENROUTER_API_KEY?.trim() || null,
}))
let keyCheck: (key: string) => Promise<void> = async () => {}
mock.module("@/lib/generation/key-check", () => ({
  fetchKeyMetadata: (key: string) => keyCheck(key),
}))

// respond.ts imports "server-only", so it has to load after installFakeDb.
const root = await import("@/app/api/settings/route")
const defaults = await import("@/app/api/settings/generation-defaults/route")
const verifyKey = await import("@/app/api/settings/verify-key/route")

const FAKE_KEY = "sk-or-route-spec-not-a-real-key"
const SAVED_KEY = process.env.OPENROUTER_API_KEY

function request(method: string, body?: unknown) {
  return new Request("http://local/api/settings", {
    method,
    headers: { "content-type": "application/json", [ORIGIN_HEADER]: "phone-1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

let bus: Awaited<ReturnType<typeof captureBus>>

beforeEach(async () => {
  db.reset()
  stubQueries({ getAppSettings: async () => ({}) })
  keyCheck = async () => {}
  process.env.OPENROUTER_API_KEY = FAKE_KEY
  bus = await captureBus()
})

afterEach(() => bus.stop())

afterAll(() => {
  if (SAVED_KEY === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = SAVED_KEY
})

describe("PATCH /api/settings", () => {
  test("applies the patch and answers with null data", async () => {
    const res = await root.PATCH(request("PATCH", { requireZdr: true }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: null })
    expect(db.argsOf(0, "set")?.[0]).toEqual({ requireZdr: true })
    expect(bus.events).toEqual([
      { kind: "change", storyId: null, entities: ["app-settings"] },
    ])
  })

  test("a rule failure is a 400 with the service's code and sentence", async () => {
    const res = await root.PATCH(request("PATCH", { imageContextTokens: 3 }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      ok: false,
      code: "invalid",
      error: "Unsupported image context size.",
    })
    expect(db.statements).toEqual([])
  })

  test("a body that is not JSON is a 400 before the service runs", async () => {
    const res = await root.PATCH(
      new Request("http://local/api/settings", { method: "PATCH", body: "{" })
    )
    expect(res.status).toBe(400)
    expect(bus.events).toEqual([])
  })
})

describe("PATCH /api/settings/generation-defaults", () => {
  test("applies the patch", async () => {
    const res = await defaults.PATCH(request("PATCH", { topP: 0.9 }))
    expect(res.status).toBe(200)
    expect(db.argsOf(0, "set")?.[0]).toEqual({ defaultTopP: 0.9 })
    expect(bus.events).toHaveLength(1)
  })

  test("an off-ladder context window is a 400", async () => {
    const res = await defaults.PATCH(request("PATCH", { contextWindow: 5000 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Unsupported context window.")
  })
})

describe("POST /api/settings/verify-key", () => {
  test("a verified key answers 200 and never echoes the key", async () => {
    const res = await verifyKey.POST(request("POST"))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(FAKE_KEY)
    const body = JSON.parse(text)
    expect(verifyOpenRouterKeyOutput.parse(body.data)).toEqual({
      verified: true,
      message: "Key verified with OpenRouter.",
    })
  })

  test("a failed check is still a 200 result, and the thrown text stays inside", async () => {
    keyCheck = async (key) => {
      throw new Error(`refused ${key}`)
    }
    const res = await verifyKey.POST(request("POST"))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(FAKE_KEY)
    expect(JSON.parse(text).data).toEqual({
      verified: false,
      message: "Couldn't reach OpenRouter. Try again.",
    })
  })
})
