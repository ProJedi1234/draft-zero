// lib/mcp/tools/profiles.test.ts — profiles, save_profile and delete_profile
// against mocked queries, the real profiles service over a scripted drizzle
// chain, and the keyless mock catalog. No live DB, no network.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { installKeylessCatalog } from "@/lib/mcp/tools/test-catalog"
import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"
import { withContentParity } from "@/lib/mcp/tools/test-results"
import { captureBus, installFakeDb } from "@/lib/services/test-support"
import type { ModelProfile, ProfileSettings } from "@/lib/types"

installQueryMocks()
installKeylessCatalog()
const db = installFakeDb()

const { registerDeleteProfile, registerProfiles, registerSaveProfile } =
  await import("@/lib/mcp/tools/profiles")

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const NOIR = "33333333-3333-4333-8333-333333333333"
const FAST = "44444444-4444-4444-8444-444444444444"
const SONNET = "~anthropic/claude-sonnet-latest"

const SETTINGS: ProfileSettings = {
  modelId: SONNET,
  thinking: "off",
  providerTag: null,
  zdr: false,
  temperature: null,
  topP: null,
  contextWindow: null,
  loreBudget: null,
  frequencyPenalty: null,
  presencePenalty: null,
}

const PROFILES: ModelProfile[] = [
  { id: NOIR, name: "Noir", sortOrder: 0, settings: SETTINGS },
  {
    id: FAST,
    name: "Fast",
    sortOrder: 1,
    settings: { ...SETTINGS, modelId: "gone/model", temperature: 1.1 },
  },
]

const DEFAULTS = {
  temperature: 0.8,
  topP: 0.95,
  contextWindow: 8192,
  loreBudget: 25,
  frequencyPenalty: 0,
  presencePenalty: 0,
}

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

type Result = {
  isError?: boolean
  content: { type: string; text: string }[]
  structuredContent?: Record<string, unknown>
}
type ToolHandler = (args: unknown, ctx?: unknown) => Promise<Result>

function handlerFor(name: string): ToolHandler {
  const handlers = new Map<string, ToolHandler>()
  const server = {
    registerTool: (tool: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(tool, withContentParity(tool, handler))
    },
  }
  for (const register of [
    registerProfiles,
    registerSaveProfile,
    registerDeleteProfile,
  ]) {
    register(server as never, {} as never)
  }
  return handlers.get(name)!
}

let bus: Awaited<ReturnType<typeof captureBus>>
let defaultProfileId: string = NOIR
let followers: Record<string, number> = {}

beforeEach(async () => {
  defaultProfileId = NOIR
  followers = { [NOIR]: 3 }
  stubQueries({
    listModelProfiles: async () => PROFILES,
    countProfileFollowers: async () => followers,
    getAppSettings: async () => ({
      defaultProfileId,
      defaultGeneration: DEFAULTS,
      requireZdr: true,
    }),
    getGenerationBaseline: async () => ({
      defaults: DEFAULTS,
      requireZdr: true,
    }),
  })
  db.reset()
  bus = await captureBus()
})

afterEach(() => bus.stop())

/* -------------------------------------------------------------------------- */
/* profiles                                                                   */
/* -------------------------------------------------------------------------- */

describe("profiles", () => {
  test("lists each profile with followers, the default and catalog info", async () => {
    const result = await handlerFor("profiles")({})

    expect(result.content[0].text).toBe('2 profiles · default "Noir"')
    const data = result.structuredContent!
    expect(data.defaults).toEqual(DEFAULTS)
    expect(data.requireZdr).toBe(true)

    const [noir, fast] = data.profiles as Record<string, unknown>[]
    expect(noir).toMatchObject({
      id: NOIR,
      name: "Noir",
      isDefault: true,
      followers: 3,
      model: SONNET,
      modelListed: true,
      modelInfo: {
        name: "Claude Sonnet Latest",
        pricing: { prompt: "$2.00", completion: "$10.00" },
      },
    })
    expect(fast).toMatchObject({
      isDefault: false,
      followers: 0,
      modelListed: false,
      modelInfo: null,
    })
    // Overrides keep their nulls: those are "inherit", not zero.
    expect(fast.overrides).toEqual({
      temperature: 1.1,
      topP: null,
      contextWindow: null,
      loreBudget: null,
      frequencyPenalty: null,
      presencePenalty: null,
    })
  })
})

/* -------------------------------------------------------------------------- */
/* save_profile                                                               */
/* -------------------------------------------------------------------------- */

describe("save_profile", () => {
  test("creates with inherit-by-default sliders and a checked model", async () => {
    db.next([{ sortOrder: 1 }])
    db.next([])
    const result = await handlerFor("save_profile")({
      name: "Kimi",
      model: "~moonshotai/kimi-latest",
      temperature: 1,
    })

    expect(result.isError).toBeUndefined()
    expect(db.statements.map((s) => s.root)).toEqual(["select", "insert"])
    expect(db.argsOf(1, "values")?.[0]).toMatchObject({
      name: "Kimi",
      modelId: "~moonshotai/kimi-latest",
      thinking: "off",
      zdr: false,
      temperature: 1,
      topP: null,
      contextWindow: null,
    })
    expect(result.structuredContent).toMatchObject({
      name: "Kimi",
      created: true,
      changed: ["name", "model", "temperature"],
      followers: 0,
      isDefault: false,
    })
    expect(bus.events).toEqual([
      { kind: "change", storyId: null, entities: ["model-profile"] },
    ])
  })

  test("makeDefault points the settings row at the new profile", async () => {
    db.next([{ sortOrder: 1 }])
    db.next([])
    db.next([{ id: "new" }])
    db.next([])
    const result = await handlerFor("save_profile")({
      name: "Kimi",
      model: "~moonshotai/kimi-latest",
      makeDefault: true,
    })

    expect(db.statements.map((s) => s.root)).toEqual([
      "select",
      "insert",
      "select",
      "update",
    ])
    expect(result.structuredContent?.isDefault).toBe(true)
    expect(result.content[0].text).toContain("now the default")
  })

  test("an unknown model is refused with the nearest ids, before any write", async () => {
    const result = await handlerFor("save_profile")({
      name: "Kimi",
      model: "moonshotai/kimi-k3",
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toStartWith(
      'No model "moonshotai/kimi-k3" in the catalog. Closest: ~moonshotai/kimi-latest'
    )
    expect(db.statements).toEqual([])
  })

  test("creating without a name or model says what is missing", async () => {
    const result = await handlerFor("save_profile")({ name: "Kimi" })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("needs a name and a model")
    expect(db.statements).toEqual([])
  })

  test("edits by name, writes only what was passed, and counts followers", async () => {
    db.next([{ id: NOIR }])
    const result = await handlerFor("save_profile")({
      profile: "noir",
      temperature: null,
      thinking: "high",
    })

    expect(result.isError).toBeUndefined()
    expect(db.statements.map((s) => s.root)).toEqual(["update"])
    expect(db.argsOf(0, "set")?.[0]).toEqual({
      thinking: "high",
      temperature: null,
    })
    expect(result.structuredContent).toMatchObject({
      id: NOIR,
      name: "Noir",
      created: false,
      changed: ["temperature", "thinking"],
      followers: 3,
      isDefault: true,
      model: SONNET,
    })
    expect(result.content[0].text).toContain("reached 3 stories")
  })

  test("an edit with nothing to change is refused", async () => {
    const result = await handlerFor("save_profile")({ profile: "Noir" })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toStartWith("Nothing to change.")
  })

  test("an unknown profile points at the list", async () => {
    const result = await handlerFor("save_profile")({
      profile: "Gothic",
      thinking: "low",
    })

    expect(result.content[0].text).toBe(
      'No profile "Gothic". Call profiles for the list.'
    )
    expect(db.statements).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* delete_profile                                                             */
/* -------------------------------------------------------------------------- */

describe("delete_profile", () => {
  test("deletes and reports how many stories went Custom", async () => {
    defaultProfileId = FAST
    db.next([{ ...SETTINGS, id: NOIR, name: "Noir", sortOrder: 0 }])
    db.next([])
    db.next([])
    const result = await handlerFor("delete_profile")({ profile: NOIR })

    expect(result.isError).toBeUndefined()
    expect(db.statements.map((s) => s.root)).toEqual([
      "select",
      "update",
      "delete",
    ])
    expect(result.structuredContent).toEqual({
      id: NOIR,
      name: "Noir",
      detached: 3,
    })
    expect(result.content[0].text).toBe(
      'deleted profile "Noir" · 3 stories now Custom with the same settings'
    )
  })

  test("the default profile is refused with the way out", async () => {
    const result = await handlerFor("delete_profile")({ profile: "Noir" })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("makeDefault")
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([])
  })
})
