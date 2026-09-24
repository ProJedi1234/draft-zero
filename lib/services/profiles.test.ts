// lib/services/profiles.test.ts — the model profile service against a scripted
// drizzle chain, the shared read-layer double, and the real sync bus.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"
import {
  profileIdOutput,
  profileWriteOutput,
} from "@/lib/services/profiles.schema"
import { captureBus, installFakeDb } from "@/lib/services/test-support"
import type { BusEvent } from "@/lib/sync/bus"
import type { ProfileSettings } from "@/lib/types"

const db = installFakeDb()
installQueryMocks()
const profiles = await import("@/lib/services/profiles")

const PROFILE = "33333333-3333-4333-8333-333333333333"
const OTHER = "44444444-4444-4444-8444-444444444444"
const STORY = "11111111-1111-4111-8111-111111111111"
const CTX = { origin: "device-a" }

const SETTINGS: ProfileSettings = {
  modelId: "vendor/model",
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

const BASELINE = {
  defaults: {
    temperature: 0.8,
    topP: 0.95,
    contextWindow: 8192,
    loreBudget: 25,
    frequencyPenalty: 0,
    presencePenalty: 0,
  },
  requireZdr: false,
}

function profileRow(overrides: Record<string, unknown> = {}) {
  return { id: PROFILE, name: "Noir", sortOrder: 0, ...SETTINGS, ...overrides }
}

function storyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STORY,
    profileId: null,
    modelId: "story/model",
    thinking: "high",
    providerTag: "fast",
    zdr: true,
    temperature: 1.1,
    topP: 0.9,
    contextWindow: 16384,
    loreBudget: 30,
    frequencyPenalty: 0.2,
    presencePenalty: 0.1,
    ...overrides,
  }
}

/** Every profile write publishes one unscoped change, with or without a hint. */
const PROFILE_CHANGE: BusEvent = {
  kind: "change",
  storyId: null,
  entities: ["model-profile"],
}
const FULL_CHANGE: BusEvent = { kind: "change", storyId: null }

let bus: Awaited<ReturnType<typeof captureBus>>
let appSettingsReads = 0

beforeEach(async () => {
  db.reset()
  appSettingsReads = 0
  stubQueries({
    getAppSettings: async () => {
      appSettingsReads += 1
      return { defaultProfileId: OTHER }
    },
    getGenerationBaseline: async () => BASELINE,
  })
  bus = await captureBus()
})

afterEach(() => bus.stop())

function expectNothingWritten() {
  expect(db.statements).toEqual([])
  expect(db.revalidated).toEqual([])
  expect(bus.events).toEqual([])
}

describe("createProfile", () => {
  test("appends after the last profile, trims the name and publishes", async () => {
    db.next([{ sortOrder: 2 }])
    db.next([])
    const result = await profiles.createProfile(
      { name: "  Noir  ", settings: { ...SETTINGS, loreBudget: 9999 } },
      CTX
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const id = profileIdOutput.parse(result.data).id
    expect(db.statements.map((s) => s.root)).toEqual(["select", "insert"])
    // Create stores the bundle as sent: only an update clamps the lore budget.
    expect(db.argsOf(1, "values")?.[0]).toEqual({
      ...SETTINGS,
      loreBudget: 9999,
      id,
      name: "Noir",
      sortOrder: 3,
    })
    expect(db.revalidated).toEqual(["/"])
    expect(bus.events).toEqual([PROFILE_CHANGE])
  })

  test("the first profile starts the order at zero", async () => {
    db.next([])
    db.next([])
    await profiles.createProfile({ name: "Noir", settings: SETTINGS }, CTX)
    expect(db.argsOf(1, "values")?.[0]).toMatchObject({ sortOrder: 0 })
  })

  test("rejects in the old action's order, with its sentences", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [
        { name: "   ", settings: { ...SETTINGS, modelId: "" } },
        "Name the profile.",
      ],
      [
        { name: "Noir", settings: { ...SETTINGS, modelId: "  " } },
        "Pick a model.",
      ],
      [
        {
          name: "Noir",
          settings: { ...SETTINGS, thinking: "huge", contextWindow: 1 },
        },
        "Unknown thinking level.",
      ],
      [
        { name: "Noir", settings: { ...SETTINGS, contextWindow: 1000 } },
        "Unsupported context window.",
      ],
    ]
    for (const [input, error] of cases) {
      const result = await profiles.createProfile(input as never, CTX)
      expect(result).toEqual({ ok: false, code: "invalid", error })
    }
    expectNothingWritten()
  })
})

describe("updateProfile", () => {
  test("patches only the given fields, clamps the lore budget, keeps nulls", async () => {
    db.next([{ id: PROFILE }])
    const result = await profiles.updateProfile(
      {
        id: PROFILE,
        patch: {
          name: " Pulp ",
          settings: { loreBudget: 9999, temperature: null, providerTag: null },
        },
      },
      CTX
    )
    expect(result).toEqual({ ok: true, data: null })
    expect(profileWriteOutput.parse(result.ok && result.data)).toBeNull()
    const set = db.argsOf(0, "set")?.[0] as Record<string, unknown>
    expect(Object.keys(set).sort()).toEqual([
      "loreBudget",
      "name",
      "providerTag",
      "temperature",
    ])
    expect(set.name).toBe("Pulp")
    expect(set.loreBudget).toBeLessThan(9999)
    expect(set.temperature).toBeNull()
    expect(bus.events).toEqual([PROFILE_CHANGE])
  })

  test("an empty patch succeeds without a write or an event", async () => {
    const result = await profiles.updateProfile({ id: PROFILE, patch: {} }, CTX)
    expect(result).toEqual({ ok: true, data: null })
    expectNothingWritten()
  })

  test("a missing row is not_found and publishes nothing", async () => {
    db.next([])
    const result = await profiles.updateProfile(
      { id: PROFILE, patch: { name: "Pulp" } },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "not_found",
      error: "Profile not found.",
    })
    expect(bus.events).toEqual([])
  })

  test("rejects in the old action's order, with its sentences", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ id: "../x", patch: { name: "" } }, "Profile not found."],
      [
        { id: PROFILE, patch: { name: " ", settings: { modelId: "" } } },
        "Name the profile.",
      ],
      [{ id: PROFILE, patch: { settings: { modelId: "" } } }, "Pick a model."],
      [
        { id: PROFILE, patch: { settings: { thinking: "huge" } } },
        "Unknown thinking level.",
      ],
      [
        { id: PROFILE, patch: { settings: { contextWindow: 3 } } },
        "Unsupported context window.",
      ],
    ]
    for (const [input, error] of cases) {
      const result = await profiles.updateProfile(input as never, CTX)
      expect(result).toEqual({ ok: false, code: "invalid", error })
    }
    expectNothingWritten()
  })
})

describe("reorderProfiles", () => {
  test("writes every position inside one transaction", async () => {
    db.next([{ id: PROFILE }, { id: OTHER }])
    const result = await profiles.reorderProfiles(
      { orderedIds: [OTHER, PROFILE] },
      CTX
    )
    expect(result).toEqual({ ok: true, data: null })
    expect(db.statements.map((s) => s.root)).toEqual([
      "select",
      "update",
      "update",
    ])
    expect(db.argsOf(1, "set")?.[0]).toEqual({ sortOrder: 0 })
    expect(db.argsOf(2, "set")?.[0]).toEqual({ sortOrder: 1 })
    expect(bus.events).toEqual([PROFILE_CHANGE])
  })

  test("a list dragged on a stale view is a conflict", async () => {
    const stale: string[][] = [[PROFILE], [PROFILE, PROFILE], [PROFILE, "gone"]]
    for (const orderedIds of stale) {
      db.next([{ id: PROFILE }, { id: OTHER }])
      const result = await profiles.reorderProfiles({ orderedIds }, CTX)
      expect(result).toEqual({
        ok: false,
        code: "conflict",
        error: "The profile list changed. Try again.",
      })
    }
    expect(db.statements.every((s) => s.root === "select")).toBe(true)
    expect(bus.events).toEqual([])
  })

  test("a body that is not a list is invalid", async () => {
    const result = await profiles.reorderProfiles(
      { orderedIds: "nope" } as never,
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "The profile list changed. Try again.",
    })
    expectNothingWritten()
  })
})

describe("setDefaultProfile", () => {
  test("ensures the settings row, then points it at the profile", async () => {
    db.next([{ id: PROFILE }])
    db.next([])
    const result = await profiles.setDefaultProfile({ id: PROFILE }, CTX)
    expect(result).toEqual({ ok: true, data: null })
    expect(appSettingsReads).toBe(1)
    expect(db.statements.map((s) => s.root)).toEqual(["select", "update"])
    expect(db.argsOf(1, "set")?.[0]).toEqual({ defaultProfileId: PROFILE })
    expect(bus.events).toEqual([PROFILE_CHANGE])
  })

  test("an unknown profile is not_found before the settings row is touched", async () => {
    db.next([])
    const result = await profiles.setDefaultProfile({ id: PROFILE }, CTX)
    expect(result).toEqual({
      ok: false,
      code: "not_found",
      error: "Profile not found.",
    })
    expect(appSettingsReads).toBe(0)
    expect(bus.events).toEqual([])
  })

  test("an id that cannot be a key is invalid", async () => {
    const result = await profiles.setDefaultProfile({ id: "a/b" }, CTX)
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Profile not found.",
    })
    expectNothingWritten()
  })
})

describe("deleteProfile", () => {
  test("freezes followers at resolved settings, then deletes", async () => {
    db.next([profileRow()])
    db.next([])
    db.next([])
    const result = await profiles.deleteProfile({ id: PROFILE }, CTX)
    expect(result).toEqual({ ok: true, data: null })
    expect(db.statements.map((s) => s.root)).toEqual([
      "select",
      "update",
      "delete",
    ])
    // An inherited slider lands as the number the baseline holds right now.
    expect(db.argsOf(1, "set")?.[0]).toMatchObject({
      profileId: null,
      modelId: "vendor/model",
      temperature: 0.8,
      topP: 0.95,
      contextWindow: 8192,
    })
    expect(bus.events).toEqual([FULL_CHANGE])
  })

  test("the default profile is refused as a conflict", async () => {
    stubQueries({
      getAppSettings: async () => ({ defaultProfileId: PROFILE }),
      getGenerationBaseline: async () => BASELINE,
    })
    const result = await profiles.deleteProfile({ id: PROFILE }, CTX)
    expect(result).toEqual({
      ok: false,
      code: "conflict",
      error: "Make another profile the default first.",
    })
    expectNothingWritten()
  })

  test("a missing row is not_found and publishes nothing", async () => {
    db.next([])
    const result = await profiles.deleteProfile({ id: PROFILE }, CTX)
    expect(result).toEqual({
      ok: false,
      code: "not_found",
      error: "Profile not found.",
    })
    expect(db.statements.map((s) => s.root)).toEqual(["select"])
    expect(bus.events).toEqual([])
  })
})

describe("setStoryProfile", () => {
  test("checks the profile, then writes profile_id and the version", async () => {
    db.next([{ id: PROFILE }])
    db.next([{ id: STORY }])
    const result = await profiles.setStoryProfile(
      { storyId: STORY, profileId: PROFILE },
      CTX
    )
    expect(result).toEqual({ ok: true, data: null })
    const set = db.argsOf(1, "set")?.[0] as Record<string, unknown>
    expect(Object.keys(set).sort()).toEqual(["profileId", "updatedAt"])
    expect(set.profileId).toBe(PROFILE)
    expect(bus.events).toEqual([FULL_CHANGE])
  })

  test("null switches to Custom without a profile lookup", async () => {
    db.next([{ id: STORY }])
    await profiles.setStoryProfile({ storyId: STORY, profileId: null }, CTX)
    expect(db.statements.map((s) => s.root)).toEqual(["update"])
    expect(db.argsOf(0, "set")?.[0]).toMatchObject({ profileId: null })
  })

  test("an unknown profile or story is not_found", async () => {
    db.next([])
    expect(
      await profiles.setStoryProfile(
        { storyId: STORY, profileId: PROFILE },
        CTX
      )
    ).toEqual({ ok: false, code: "not_found", error: "Profile not found." })

    db.next([])
    expect(
      await profiles.setStoryProfile({ storyId: STORY, profileId: null }, CTX)
    ).toEqual({ ok: false, code: "not_found", error: "Story not found." })
    expect(bus.events).toEqual([])
  })

  test("ids that cannot be keys are invalid, profile first", async () => {
    expect(
      await profiles.setStoryProfile({ storyId: "a b", profileId: "c d" }, CTX)
    ).toEqual({ ok: false, code: "invalid", error: "Profile not found." })
    expect(
      await profiles.setStoryProfile({ storyId: "a b", profileId: null }, CTX)
    ).toEqual({ ok: false, code: "invalid", error: "Story not found." })
    expectNothingWritten()
  })
})

describe("saveStoryAsProfile", () => {
  test("promotes a Custom story's settings and points the story at them", async () => {
    db.next([storyRow()])
    db.next([{ sortOrder: 0 }])
    db.next([])
    db.next([])
    const result = await profiles.saveStoryAsProfile(
      { storyId: STORY, name: " Tuned " },
      CTX
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const id = profileIdOutput.parse(result.data).id
    expect(db.statements.map((s) => s.root)).toEqual([
      "select",
      "select",
      "insert",
      "update",
    ])
    expect(db.argsOf(2, "values")?.[0]).toEqual({
      id,
      name: "Tuned",
      sortOrder: 1,
      modelId: "story/model",
      thinking: "high",
      providerTag: "fast",
      zdr: true,
      temperature: 1.1,
      topP: 0.9,
      contextWindow: 16384,
      loreBudget: 30,
      frequencyPenalty: 0.2,
      presencePenalty: 0.1,
    })
    expect(db.argsOf(3, "set")?.[0]).toMatchObject({ profileId: id })
    expect(bus.events).toEqual([FULL_CHANGE])
  })

  test("a following story is saved from its profile's effective settings", async () => {
    db.next([storyRow({ profileId: PROFILE })])
    db.next([profileRow()])
    db.next([])
    db.next([])
    db.next([])
    await profiles.saveStoryAsProfile({ storyId: STORY, name: "Copy" }, CTX)
    expect(db.argsOf(3, "values")?.[0]).toMatchObject({
      modelId: "vendor/model",
      temperature: 0.8,
      contextWindow: 8192,
    })
  })

  test("a missing story is not_found before the name is judged", async () => {
    db.next([])
    const result = await profiles.saveStoryAsProfile(
      { storyId: STORY, name: " " },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "not_found",
      error: "Story not found.",
    })
    expect(bus.events).toEqual([])
  })

  test("a blank name is refused after the story read, before any write", async () => {
    db.next([storyRow()])
    const result = await profiles.saveStoryAsProfile(
      { storyId: STORY, name: "  " },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Name the profile.",
    })
    expect(db.statements.map((s) => s.root)).toEqual(["select"])
    expect(bus.events).toEqual([])
  })

  test("a story id that cannot be a key is invalid", async () => {
    const result = await profiles.saveStoryAsProfile(
      { storyId: "a/b", name: "x" },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Story not found.",
    })
    expectNothingWritten()
  })
})
