// tests/api/profiles-routes.test.ts — round trips through the model profile
// route handlers, over the real service and bus, against a scripted drizzle
// chain and the shared read-layer double.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { ORIGIN_HEADER } from "@/lib/services/context"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"
import { profileIdOutput } from "@/lib/services/profiles.schema"
import { captureBus, installFakeDb } from "@/lib/services/test-support"

const db = installFakeDb()
installQueryMocks()
// Imported after the doubles: respond.ts pulls in "server-only" at load time.
const collection = await import("@/app/api/profiles/route")
const item = await import("@/app/api/profiles/[profileId]/route")
const reorder = await import("@/app/api/profiles/reorder/route")
const makeDefault = await import("@/app/api/profiles/[profileId]/default/route")
const storyProfile = await import("@/app/api/stories/[storyId]/profile/route")
const saveAs = await import("@/app/api/stories/[storyId]/save-as-profile/route")

const PROFILE = "33333333-3333-4333-8333-333333333333"
const STORY = "11111111-1111-4111-8111-111111111111"

const SETTINGS = {
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

const STORY_ROW = {
  id: STORY,
  profileId: null,
  modelId: "story/model",
  thinking: "off",
  providerTag: null,
  zdr: false,
  temperature: 1,
  topP: 1,
  contextWindow: 8192,
  loreBudget: 25,
  frequencyPenalty: 0,
  presencePenalty: 0,
}

function request(method: string, body?: unknown, origin = "phone-1") {
  return new Request("http://local/api/profiles", {
    method,
    headers: { "content-type": "application/json", [ORIGIN_HEADER]: origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const profileParams = { params: Promise.resolve({ profileId: PROFILE }) }
const storyParams = { params: Promise.resolve({ storyId: STORY }) }

let bus: Awaited<ReturnType<typeof captureBus>>

beforeEach(async () => {
  db.reset()
  stubQueries({
    getAppSettings: async () => ({ defaultProfileId: null }),
    getGenerationBaseline: async () => ({
      defaults: {
        temperature: 1,
        topP: 1,
        contextWindow: 8192,
        loreBudget: 25,
        frequencyPenalty: 0,
        presencePenalty: 0,
      },
      requireZdr: false,
    }),
  })
  bus = await captureBus()
})

afterEach(() => bus.stop())

describe("POST /api/profiles", () => {
  test("creates, answers with the new id, and publishes", async () => {
    db.next([])
    db.next([])
    const res = await collection.POST(
      request("POST", { name: "Noir", settings: SETTINGS })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(profileIdOutput.parse(body.data).id).toBe(
      (db.argsOf(1, "values")?.[0] as { id: string }).id
    )
    expect(bus.events).toEqual([
      { kind: "change", storyId: null, entities: ["model-profile"] },
    ])
  })

  test("a schema failure is a 400 with the service's code and sentence", async () => {
    const res = await collection.POST(
      request("POST", { name: " ", settings: SETTINGS })
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      ok: false,
      code: "invalid",
      error: "Name the profile.",
    })
  })

  test("a body that is not JSON is a 400 before the service runs", async () => {
    const res = await collection.POST(
      new Request("http://local/api/profiles", { method: "POST", body: "{" })
    )
    expect(res.status).toBe(400)
    expect(db.statements).toEqual([])
  })
})

describe("PATCH /api/profiles/:profileId", () => {
  test("applies the body as the patch", async () => {
    db.next([{ id: PROFILE }])
    const res = await item.PATCH(
      request("PATCH", { name: "Pulp", settings: { thinking: "high" } }),
      profileParams
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: null })
    expect(db.argsOf(0, "set")?.[0]).toEqual({ name: "Pulp", thinking: "high" })
  })

  test("an unknown profile is a 404", async () => {
    db.next([])
    const res = await item.PATCH(request("PATCH", { name: "x" }), profileParams)
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe("not_found")
  })
})

describe("DELETE /api/profiles/:profileId", () => {
  test("deletes and announces a full catch-up", async () => {
    db.next([{ id: PROFILE, name: "Noir", sortOrder: 0, ...SETTINGS }])
    const res = await item.DELETE(request("DELETE"), profileParams)
    expect(res.status).toBe(200)
    expect(bus.events).toEqual([{ kind: "change", storyId: null }])
  })

  test("the default profile is a 409", async () => {
    stubQueries({ getAppSettings: async () => ({ defaultProfileId: PROFILE }) })
    const res = await item.DELETE(request("DELETE"), profileParams)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(
      "Make another profile the default first."
    )
  })
})

describe("POST /api/profiles/reorder", () => {
  test("a stale list is a 409", async () => {
    db.next([{ id: PROFILE }])
    const res = await reorder.POST(request("POST", { orderedIds: [] }))
    expect(res.status).toBe(409)
    expect(bus.events).toEqual([])
  })

  test("a matching list is written", async () => {
    db.next([{ id: PROFILE }])
    const res = await reorder.POST(request("POST", { orderedIds: [PROFILE] }))
    expect(res.status).toBe(200)
    expect(db.argsOf(1, "set")?.[0]).toEqual({ sortOrder: 0 })
  })
})

describe("POST /api/profiles/:profileId/default", () => {
  test("points the settings row at the profile", async () => {
    db.next([{ id: PROFILE }])
    const res = await makeDefault.POST(request("POST"), profileParams)
    expect(res.status).toBe(200)
    expect(db.argsOf(1, "set")?.[0]).toEqual({ defaultProfileId: PROFILE })
  })
})

describe("POST /api/stories/:storyId/profile", () => {
  test("takes the story from the path and the profile from the body", async () => {
    db.next([{ id: PROFILE }])
    db.next([{ id: STORY }])
    const res = await storyProfile.POST(
      request("POST", { profileId: PROFILE }),
      storyParams
    )
    expect(res.status).toBe(200)
    expect(db.argsOf(1, "set")?.[0]).toMatchObject({ profileId: PROFILE })
  })

  test("an unknown story is a 404", async () => {
    db.next([])
    const res = await storyProfile.POST(
      request("POST", { profileId: null }),
      storyParams
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe("Story not found.")
  })
})

describe("POST /api/stories/:storyId/save-as-profile", () => {
  test("creates a profile from the story and answers with its id", async () => {
    db.next([STORY_ROW])
    const res = await saveAs.POST(
      request("POST", { name: "Tuned" }),
      storyParams
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(db.argsOf(3, "set")?.[0]).toMatchObject({
      profileId: profileIdOutput.parse(body.data).id,
    })
  })
})
