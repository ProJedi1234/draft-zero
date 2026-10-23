// lib/mcp/model-settings.test.ts — the field schemas, the model check and the
// profile lookup the settings tools share. Pure; no db, no network.
import { describe, expect, test } from "bun:test"
import { z } from "zod"

import { installFakeDb } from "@/lib/services/test-support"
import type { ModelProfile, OpenRouterModel } from "@/lib/types"

// Doubles "server-only", which the model catalog module imports.
installFakeDb()

const { lookupModel } = await import("@/lib/generation/models")
const {
  checkModel,
  closestModelIds,
  findProfile,
  profileSettingsFields,
  storySettingsFields,
  toSettingsPatch,
} = await import("@/lib/mcp/model-settings")

function model(id: string): OpenRouterModel {
  return {
    id,
    name: id,
    provider: "Lab",
    contextLength: 128_000,
    maxCompletionTokens: null,
    pricing: { prompt: "$1.00", completion: "$2.00" },
    reasoning: null,
    zdr: false,
  }
}

const REMOTE = [
  model("deepseek/deepseek-v4-flash"),
  model("deepseek/deepseek-v4-pro"),
  model("z-ai/glm-5.3-flash"),
  model("openai/gpt-6.1"),
]
const LOCAL = [model("ollama:qwen3.8:27b-mlx")]

describe("lookupModel", () => {
  test("looks in the half of the catalog that would serve the id", () => {
    const catalog = { local: LOCAL, remote: REMOTE }
    expect(lookupModel(catalog, "z-ai/glm-5.3-flash").status).toBe("found")
    expect(lookupModel(catalog, "ollama:qwen3.8:27b-mlx").status).toBe("found")
    expect(lookupModel(catalog, "ollama:z-ai/glm-5.3-flash").status).toBe(
      "unknown"
    )
  })

  test("a half that could not be read vouches for nothing", () => {
    const catalog = { local: null, remote: null }
    expect(lookupModel(catalog, "made/up").status).toBe("unverifiable")
    expect(lookupModel(catalog, "ollama:made-up").status).toBe("unverifiable")
  })
})

describe("checkModel", () => {
  test("returns the catalog entry, or null when it cannot check", () => {
    expect(
      checkModel({ local: null, remote: REMOTE }, "openai/gpt-6.1")?.id
    ).toBe("openai/gpt-6.1")
    expect(checkModel({ local: null, remote: null }, "made/up")).toBeNull()
  })

  test("refuses an unknown id, nearest ids first", () => {
    expect(() =>
      checkModel({ local: null, remote: REMOTE }, "deepseek/deepseek-v4")
    ).toThrow(
      'No model "deepseek/deepseek-v4" in the catalog. Closest: deepseek/deepseek-v4-pro, deepseek/deepseek-v4-flash.'
    )
  })

  test("with nothing near, it says what an id looks like", () => {
    expect(() =>
      checkModel({ local: null, remote: REMOTE }, "mistral")
    ).toThrow('Ids look like "author/model"')
  })
})

describe("closestModelIds", () => {
  test("ranks by shared word length, so the lab name beats a version", () => {
    expect(closestModelIds("glm-5.3", REMOTE)).toEqual(["z-ai/glm-5.3-flash"])
    expect(closestModelIds("deepseek flash", REMOTE, 1)).toEqual([
      "deepseek/deepseek-v4-flash",
    ])
  })
})

describe("findProfile", () => {
  const profile = (id: string, name: string) =>
    ({ id, name }) as unknown as ModelProfile
  const PROFILES = [
    profile("p1", "Noir"),
    profile("p2", "Fast"),
    profile("p3", "fast "),
  ]

  test("matches an id, then a name without case or padding", () => {
    expect(findProfile(PROFILES, "p2").name).toBe("Fast")
    expect(findProfile(PROFILES, "NOIR").id).toBe("p1")
  })

  test("an ambiguous name asks for an id", () => {
    expect(() => findProfile(PROFILES, "fast")).toThrow(
      '2 profiles are named "fast". Pass one of their ids instead: p2, p3.'
    )
  })
})

describe("settings fields", () => {
  test("a story's sliders are concrete; a profile's may inherit", () => {
    const story = z.object(storySettingsFields)
    const profile = z.object(profileSettingsFields)
    expect(story.safeParse({ temperature: null }).success).toBe(false)
    expect(profile.safeParse({ temperature: null }).success).toBe(true)
  })

  test("ranges and the context ladder are enforced", () => {
    const profile = z.object(profileSettingsFields)
    expect(profile.safeParse({ temperature: 3 }).success).toBe(false)
    expect(profile.safeParse({ loreBudget: 60 }).success).toBe(false)
    expect(profile.safeParse({ contextWindow: 9000 }).success).toBe(false)
    expect(profile.safeParse({ contextWindow: 16384 }).success).toBe(true)
  })

  test("a patch keeps nulls, drops undefined and renames model", () => {
    expect(
      toSettingsPatch({ model: "a/b", temperature: null, topP: undefined })
    ).toEqual({ modelId: "a/b", temperature: null })
  })
})
