// tests/api/models-routes.test.ts — round trips through the model endpoints
// and account ZDR routes. Offline: the key is doubled to null, so both reads
// answer from the mock catalogs.
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"

import { installFakeDb } from "@/lib/services/test-support"
import { ZDR_GROUPS } from "@/lib/types"

installFakeDb()

// Other specs double this module process-wide with a fake key; see
// lib/services/models.test.ts.
let keyless = false
mock.module("@/lib/generation/key", () => ({
  resolveOpenRouterKey: () => {
    if (keyless) return null
    const env = process.env.OPENROUTER_API_KEY?.trim()
    return env ? env : null
  },
}))

const endpoints = await import("@/app/api/models/endpoints/[...modelId]/route")
const zdrAll = await import("@/app/api/zdr/route")
const zdrOne = await import("@/app/api/zdr/[...modelId]/route")
const { MOCK_MODELS } = await import("@/lib/mock-data")

beforeAll(() => {
  keyless = true
})

afterAll(() => {
  keyless = false
})

const get = () => new Request("http://local/api", { method: "GET" })
const segments = (id: string) => ({
  params: Promise.resolve({ modelId: id.split("/") }),
})

describe("GET /api/models/endpoints/:author/:slug", () => {
  test("rejoins the path into the model id", async () => {
    const model = MOCK_MODELS.find((m) => m.id.includes("/"))!
    const res = await endpoints.GET(get(), segments(model.id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.length).toBeGreaterThan(0)
  })

  test("a blank id is a 400 with the old sentence", async () => {
    const res = await endpoints.GET(get(), segments(" "))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("No model selected.")
  })
})

describe("GET /api/zdr", () => {
  test("answers every group", async () => {
    const res = await zdrAll.GET(get())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body.data).sort()).toEqual([...ZDR_GROUPS].sort())
  })
})

describe("GET /api/zdr/:author/:slug", () => {
  test("answers the model's group", async () => {
    const res = await zdrOne.GET(get(), segments("anthropic/claude-x"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: "unknown" })
  })
})
