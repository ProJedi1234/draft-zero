// tests/workspace-cache.test.ts — The manuscript cache's two load-bearing
// promises: it survives a reload, and it does not grow without bound as a
// library does.

import { beforeEach, describe, expect, test } from "bun:test"

import { InMemoryPersistence } from "@/lib/store/persistence"
import {
  attachWorkspacePersistence,
  cachedStoryIdsForTests,
  clearWorkspaceCacheForTests,
  getCachedPayload,
  putCachedPayload,
  WORKSPACE_CACHE_LIMIT,
} from "@/lib/story/workspace-cache"
import type { StoryWorkspacePayload } from "@/lib/story/workspace-payload"

function payload(id: string, updatedAt = "2026-08-29T00:00:00.000Z") {
  return {
    story: { id, title: `Story ${id}`, updatedAt, entries: [] },
  } as unknown as StoryWorkspacePayload
}

/** Lets the write-through chain settle; putCachedPayload does not await it. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  clearWorkspaceCacheForTests()
})

describe("workspace cache", () => {
  test("a payload written in one session is there in the next", async () => {
    const disk = new InMemoryPersistence()
    await attachWorkspacePersistence(disk)
    putCachedPayload("mary", payload("mary"))
    await settle()

    // The reload: memory is gone, the same disk is handed back.
    clearWorkspaceCacheForTests()
    expect(getCachedPayload("mary")).toBeUndefined()
    await attachWorkspacePersistence(disk)

    expect(getCachedPayload("mary")?.story.id).toBe("mary")
  })

  test("holds no more than the sidebar's window, dropping the oldest", async () => {
    const disk = new InMemoryPersistence()
    await attachWorkspacePersistence(disk)
    for (let i = 0; i < WORKSPACE_CACHE_LIMIT + 5; i++) {
      putCachedPayload(`story-${i}`, payload(`story-${i}`))
    }
    await settle()

    const held = cachedStoryIdsForTests()
    expect(held.length).toBe(WORKSPACE_CACHE_LIMIT)
    expect(held).not.toContain("story-0")
    expect(held).toContain(`story-${WORKSPACE_CACHE_LIMIT + 4}`)

    // And the disk agrees — an evicted manuscript is not left behind to grow
    // the database forever.
    expect((await disk.loadWorkspaces()).length).toBe(WORKSPACE_CACHE_LIMIT)
  })

  test("reading a payload keeps it from being the next one evicted", async () => {
    const disk = new InMemoryPersistence()
    await attachWorkspacePersistence(disk)
    for (let i = 0; i < WORKSPACE_CACHE_LIMIT; i++) {
      putCachedPayload(`story-${i}`, payload(`story-${i}`))
    }
    // story-0 is next out by age; reading it should move it to the back.
    getCachedPayload("story-0")
    putCachedPayload("newcomer", payload("newcomer"))
    await settle()

    const held = cachedStoryIdsForTests()
    expect(held).toContain("story-0")
    expect(held).not.toContain("story-1")
  })

  test("a live payload is not overwritten by an older one from disk", async () => {
    const disk = new InMemoryPersistence()
    await disk.putWorkspace({
      id: "mary",
      version: "2026-08-01T00:00:00.000Z",
      savedAt: 1,
      payload: payload("mary", "2026-08-01T00:00:00.000Z"),
    })

    putCachedPayload("mary", payload("mary", "2026-08-29T00:00:00.000Z"))
    await attachWorkspacePersistence(disk)

    expect(getCachedPayload("mary")?.story.updatedAt).toBe(
      "2026-08-29T00:00:00.000Z"
    )
  })
})
