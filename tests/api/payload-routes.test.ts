// tests/api/payload-routes.test.ts — the read-only page payloads the native
// client fetches over HTTP. Offline: the key is doubled to null, so the model
// catalogs answer from their mocks, and every read is a stubbed query.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"
import { installFakeDb } from "@/lib/services/test-support"
import type { GalleryImage, ModelProfile } from "@/lib/types"

installFakeDb()
installQueryMocks()

// Other specs double this module process-wide with a fake key; see
// tests/api/models-routes.test.ts.
let keyless = false
mock.module("@/lib/generation/key", () => ({
  resolveOpenRouterKey: () => {
    if (keyless) return null
    const env = process.env.OPENROUTER_API_KEY?.trim()
    return env ? env : null
  },
}))

const settingsRoute = await import("@/app/api/settings/route")
const galleryRoute = await import("@/app/api/gallery/route")
const libraryRoute = await import("@/app/api/library/route")

beforeAll(() => {
  keyless = true
})

afterAll(() => {
  keyless = false
})

const PROFILE: ModelProfile = {
  id: "profile-1",
  name: "Default",
  sortOrder: 0,
  settings: {
    modelId: "anthropic/claude-x",
    thinking: "off",
    providerTag: null,
    zdr: false,
    temperature: null,
    topP: null,
    contextWindow: null,
    loreBudget: null,
    frequencyPenalty: null,
    presencePenalty: null,
  },
}

const IMAGE: GalleryImage = {
  id: "image-1",
  prompt: "A lantern in the rain",
  aspectRatio: "16:9",
  mediaType: "image/png",
  modelId: "google/image-x",
  createdAt: "2026-09-01T00:00:00.000Z",
  storyId: "story-1",
  storyTitle: "The Lantern",
  tintHue: null,
  tintStrength: 0,
  imageGroupId: "group-1",
  imageIndex: 0,
  takes: [],
}

beforeEach(() => {
  stubQueries({
    getAppSettings: async () => ({
      defaultProfileId: PROFILE.id,
      requireZdr: false,
      defaultImageModelId: null,
      imageContextTokens: 4096,
    }),
    listModelProfiles: async () => [PROFILE],
    countProfileFollowers: async () => ({ [PROFILE.id]: 3 }),
    listGalleryImages: async (options?: { limit?: number }) =>
      options?.limit === undefined ? [IMAGE, IMAGE] : [IMAGE],
    listStoryExcerpts: async () => ({ "story-1": "…and the door opened." }),
  })
})

describe("GET /api/settings", () => {
  test("answers the settings page's payload, uncached", async () => {
    const res = await settingsRoute.GET()
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = await res.json()
    expect(body.settings.defaultProfileId).toBe(PROFILE.id)
    expect(body.profiles).toEqual([PROFILE])
    expect(body.followerCounts).toEqual({ [PROFILE.id]: 3 })
    expect(Array.isArray(body.models)).toBe(true)
    expect(Array.isArray(body.imageModels)).toBe(true)
    expect("defaultImagePrice" in body).toBe(true)
  })
})

describe("GET /api/gallery", () => {
  test("answers every picture, unlimited", async () => {
    const res = await galleryRoute.GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ images: [IMAGE, IMAGE] })
  })
})

describe("GET /api/library", () => {
  test("answers excerpts, the capped rail, and the live runs", async () => {
    const res = await libraryRoute.GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      excerpts: { "story-1": "…and the door opened." },
      railImages: [IMAGE],
      activeRuns: [],
    })
  })
})
