// lib/services/models.test.ts — the model and zdr reads, offline. With no
// OpenRouter key the generation modules answer from their mock catalogs before
// reaching for the network, so the only double is the key itself.
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"

import { getModelEndpointsOutput } from "@/lib/services/models.schema"
import { installFakeDb } from "@/lib/services/test-support"
import { getAccountZdrPoliciesOutput } from "@/lib/services/zdr.schema"
import { ZDR_GROUPS } from "@/lib/types"

installFakeDb()

// Other specs double this module process-wide with a fake key, which would
// send these reads to OpenRouter. Outside this file it reads the env as the
// real module does.
let keyless = false
mock.module("@/lib/generation/key", () => ({
  resolveOpenRouterKey: () => {
    if (keyless) return null
    const env = process.env.OPENROUTER_API_KEY?.trim()
    return env ? env : null
  },
}))

const models = await import("@/lib/services/models")
const zdr = await import("@/lib/services/zdr")
const { MOCK_MODELS } = await import("@/lib/mock-data")

const CTX = { origin: null }
beforeAll(() => {
  keyless = true
})

afterAll(() => {
  keyless = false
})

describe("getModelEndpoints", () => {
  test("answers a catalog model with its endpoints", async () => {
    const result = await models.getModelEndpoints(
      { modelId: MOCK_MODELS[0].id },
      CTX
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(getModelEndpointsOutput.parse(result.data).length).toBeGreaterThan(0)
  })

  test("an unknown model is an empty list, not a failure", async () => {
    const result = await models.getModelEndpoints(
      { modelId: "nobody/nothing" },
      CTX
    )
    expect(result).toEqual({ ok: true, data: [] })
  })

  test("a blank or missing id is the old sentence", async () => {
    for (const modelId of ["", "   ", undefined]) {
      const result = await models.getModelEndpoints({ modelId } as never, CTX)
      expect(result).toEqual({
        ok: false,
        code: "invalid",
        error: "No model selected.",
      })
    }
  })
})

describe("getAccountZdrForModel", () => {
  test("a blank id is unknown without asking", async () => {
    expect(await zdr.getAccountZdrForModel({ modelId: "  " }, CTX)).toEqual({
      ok: true,
      data: "unknown",
    })
  })

  test("with no key configured the account answers unknown", async () => {
    const result = await zdr.getAccountZdrForModel(
      { modelId: "anthropic/claude-x" },
      CTX
    )
    expect(result).toEqual({ ok: true, data: "unknown" })
  })

  test("a non-string id is invalid", async () => {
    const result = await zdr.getAccountZdrForModel({ modelId: 7 } as never, CTX)
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Invalid model id.",
    })
  })
})

describe("getAccountZdrPolicies", () => {
  test("answers every group", async () => {
    const result = await zdr.getAccountZdrPolicies({}, CTX)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const policies = getAccountZdrPoliciesOutput.parse(result.data)
    expect(Object.keys(policies).sort()).toEqual([...ZDR_GROUPS].sort())
    expect(new Set(Object.values(policies))).toEqual(new Set(["unknown"]))
  })
})
