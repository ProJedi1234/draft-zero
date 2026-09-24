// lib/services/settings.test.ts — the settings service against a scripted
// drizzle chain and the real sync bus. No live DB, no HTTP, no OpenRouter.
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"
import { OpenRouterError } from "@openrouter/sdk/models/errors"
import { verifyOpenRouterKeyOutput } from "@/lib/services/settings.schema"
import { captureBus, installFakeDb } from "@/lib/services/test-support"
import type { BusEvent } from "@/lib/sync/bus"

const db = installFakeDb()
installQueryMocks()

// Other specs double this module with their own key; this one restores the
// real env read so a test can set OPENROUTER_API_KEY and mean it.
mock.module("@/lib/generation/key", () => ({
  resolveOpenRouterKey: () => process.env.OPENROUTER_API_KEY?.trim() || null,
}))
let keyCheck: (key: string) => Promise<void> = async () => {}
const checkedKeys: string[] = []
mock.module("@/lib/generation/key-check", () => ({
  fetchKeyMetadata: (key: string) => {
    checkedKeys.push(key)
    return keyCheck(key)
  },
}))

const atmosphere = await import("@/lib/generation/atmosphere")
const settings = await import("@/lib/services/settings")

const CTX = { origin: "device-a" }
const FAKE_KEY = "sk-or-spec-not-a-real-key"
const SAVED_KEY = process.env.OPENROUTER_API_KEY

const SUMMARIZER = {
  modelId: "  vendor/summarizer  ",
  thinking: "off" as const,
  providerTag: null,
  zdr: false,
  temperature: 0.3,
  targetWords: 200,
  maxTokens: 1024,
}

const ATMOSPHERE = {
  engine: "llm" as const,
  minConfidence: 0.7,
  modelId: "",
  thinking: "low" as const,
  providerTag: "deepinfra",
  zdr: true,
  temperature: 0.5,
  maxTokens: 64,
  passagesBetweenChecks: 3,
}

const SETTINGS_CHANGED: BusEvent = {
  kind: "change",
  storyId: null,
  entities: ["app-settings"],
}

let bus: Awaited<ReturnType<typeof captureBus>>
let settingsReads = 0
let clearBreaker: ReturnType<typeof spyOn>

beforeEach(async () => {
  db.reset()
  settingsReads = 0
  stubQueries({
    getAppSettings: async () => {
      settingsReads++
      return {}
    },
  })
  clearBreaker = spyOn(atmosphere, "clearAtmosphereBreaker")
  bus = await captureBus()
})

afterEach(() => {
  bus.stop()
  clearBreaker.mockRestore()
})

afterAll(() => {
  if (SAVED_KEY === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = SAVED_KEY
})

describe("updateAppSettings", () => {
  test("writes the patched columns and announces a library-level change", async () => {
    const result = await settings.updateAppSettings(
      {
        defaultModelId: "  vendor/model  ",
        defaultThinking: "high",
        requireZdr: true,
        defaultImageModelId: "   ",
        imageContextTokens: 4096,
      },
      CTX
    )

    expect(result).toEqual({ ok: true, data: null })
    expect(settingsReads).toBe(1)
    expect(db.statements.map((s) => s.root)).toEqual(["update"])
    expect(db.argsOf(0, "set")?.[0]).toEqual({
      defaultModelId: "vendor/model",
      defaultThinking: "high",
      requireZdr: true,
      defaultImageModelId: null,
      imageContextTokens: 4096,
    })
    expect(db.revalidated).toEqual(["/"])
    expect(bus.events).toEqual([SETTINGS_CHANGED])
    expect(clearBreaker).not.toHaveBeenCalled()
  })

  test("maps the summarizer bundle onto its columns", async () => {
    await settings.updateAppSettings({ summarizer: SUMMARIZER }, CTX)
    expect(db.argsOf(0, "set")?.[0]).toEqual({
      summaryModelId: "vendor/summarizer",
      summaryThinking: "off",
      summaryProviderTag: null,
      summaryZdr: false,
      summaryTemperature: 0.3,
      summaryTargetWords: 200,
      summaryMaxTokens: 1024,
    })
    expect(bus.events).toEqual([SETTINGS_CHANGED])
  })

  test("maps the atmosphere bundle and clears the breaker", async () => {
    await settings.updateAppSettings({ atmosphere: ATMOSPHERE }, CTX)
    expect(db.argsOf(0, "set")?.[0]).toEqual({
      atmosphereModelId: null,
      atmosphereEngine: "llm",
      atmosphereMinConfidence: 0.7,
      atmosphereThinking: "low",
      atmosphereProviderTag: "deepinfra",
      atmosphereZdr: true,
      atmosphereTemperature: 0.5,
      atmosphereMaxTokens: 64,
      atmospherePassagesBetweenChecks: 3,
    })
    expect(clearBreaker).toHaveBeenCalledTimes(1)
    expect(bus.events).toEqual([SETTINGS_CHANGED])
  })

  test("an empty patch still ensures the row and announces, but writes nothing", async () => {
    const result = await settings.updateAppSettings(
      { defaultProfileId: "ignored" } as never,
      CTX
    )
    expect(result).toEqual({ ok: true, data: null })
    expect(settingsReads).toBe(1)
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([SETTINGS_CHANGED])
  })

  test("refuses with the old action's sentences, before any read or write", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ defaultModelId: "   " }, "Pick a default model."],
      [{ defaultThinking: "extreme" }, "Unknown thinking level."],
      [
        { summarizer: { ...SUMMARIZER, thinking: "extreme" } },
        "Unknown thinking level.",
      ],
      [
        { summarizer: { ...SUMMARIZER, temperature: 2.5 } },
        "Temperature must be between 0 and 2.",
      ],
      [
        { summarizer: { ...SUMMARIZER, targetWords: 10 } },
        "Summary length must be 25–2000 words.",
      ],
      [
        { summarizer: { ...SUMMARIZER, maxTokens: 9000 } },
        "Output cap must be 64–8192 tokens.",
      ],
      [
        { atmosphere: { ...ATMOSPHERE, engine: "oracle" } },
        "Unknown atmosphere engine.",
      ],
      [
        { atmosphere: { ...ATMOSPHERE, minConfidence: 1 } },
        "Confidence must be between 0.5 and 0.95.",
      ],
      [
        { atmosphere: { ...ATMOSPHERE, thinking: "extreme" } },
        "Unknown thinking level.",
      ],
      [
        { atmosphere: { ...ATMOSPHERE, temperature: -1 } },
        "Temperature must be between 0 and 2.",
      ],
      [
        { atmosphere: { ...ATMOSPHERE, maxTokens: 16.5 } },
        "Max tokens must be a whole number between 16 and 32000.",
      ],
      [
        { atmosphere: { ...ATMOSPHERE, passagesBetweenChecks: 0 } },
        "Passages between checks must be a whole number between 1 and 50.",
      ],
      [{ imageContextTokens: 3000 }, "Unsupported image context size."],
    ]
    for (const [patch, error] of cases) {
      const result = await settings.updateAppSettings(patch as never, CTX)
      expect(result).toEqual({ ok: false, code: "invalid", error })
    }
    expect(settingsReads).toBe(0)
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([])
    expect(clearBreaker).not.toHaveBeenCalled()
  })

  test("NaN fails a range rule rather than slipping past it", async () => {
    const result = await settings.updateAppSettings(
      { summarizer: { ...SUMMARIZER, temperature: Number.NaN } },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Temperature must be between 0 and 2.",
    })
  })

  test("checks fields in the old action's order", async () => {
    const result = await settings.updateAppSettings(
      {
        defaultThinking: "extreme",
        summarizer: { ...SUMMARIZER, temperature: 9 },
        imageContextTokens: 3,
      } as never,
      CTX
    )
    expect(result.ok || result.error).toBe("Unknown thinking level.")
  })
})

describe("updateGenerationDefaults", () => {
  test("writes the given defaults, clamps the lore budget, and announces", async () => {
    const result = await settings.updateGenerationDefaults(
      { temperature: 1.1, contextWindow: 8192, loreBudget: 73 },
      CTX
    )
    expect(result).toEqual({ ok: true, data: null })
    expect(settingsReads).toBe(1)
    expect(db.argsOf(0, "set")?.[0]).toEqual({
      defaultTemperature: 1.1,
      defaultContextWindow: 8192,
      defaultLoreBudget: 50,
    })
    expect(db.revalidated).toEqual(["/"])
    expect(bus.events).toEqual([SETTINGS_CHANGED])
  })

  test("an empty patch is a no-op that announces nothing", async () => {
    const result = await settings.updateGenerationDefaults({}, CTX)
    expect(result).toEqual({ ok: true, data: null })
    expect(settingsReads).toBe(0)
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([])
  })

  test("an off-ladder context window is invalid and writes nothing", async () => {
    const result = await settings.updateGenerationDefaults(
      { temperature: 1, contextWindow: 5000 },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Unsupported context window.",
    })
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([])
  })
})

describe("verifyOpenRouterKey", () => {
  beforeEach(() => {
    checkedKeys.length = 0
    keyCheck = async () => {}
    process.env.OPENROUTER_API_KEY = FAKE_KEY
  })

  async function verify() {
    const result = await settings.verifyOpenRouterKey({}, CTX)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("unreachable")
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY)
    return verifyOpenRouterKeyOutput.parse(result.data)
  }

  test("no key configured answers before any call", async () => {
    delete process.env.OPENROUTER_API_KEY
    expect(await verify()).toEqual({
      verified: false,
      message: "OPENROUTER_API_KEY is not configured.",
    })
    expect(checkedKeys).toEqual([])
  })

  test("an accepted key verifies", async () => {
    expect(await verify()).toEqual({
      verified: true,
      message: "Key verified with OpenRouter.",
    })
    expect(checkedKeys).toEqual([FAKE_KEY])
  })

  test("a 401 is a rejected key", async () => {
    keyCheck = async () => {
      throw new OpenRouterError("Unauthorized", {
        response: new Response("{}", { status: 401 }),
        request: new Request("http://openrouter.invalid/key"),
        body: "{}",
      })
    }
    expect(await verify()).toEqual({
      verified: false,
      message: "OpenRouter rejected this key.",
    })
  })

  test("anything else is unreachable, and the thrown text never leaks", async () => {
    keyCheck = async (key) => {
      throw new Error(`socket closed for ${key}`)
    }
    expect(await verify()).toEqual({
      verified: false,
      message: "Couldn't reach OpenRouter. Try again.",
    })
  })
})
