// tests/store-lore-mutations.test.ts — What the optimistic lorebook mutations
// put in the overlay, what they send, and what they fold back. The server
// actions are mocked through the module's own seam (never mock.module — see the
// note in tests/store-mutations.test.ts about poisoning the whole process).

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

// `server-only` throws outside a React Server Component graph, and the actions
// this file's subject imports carry the marker. A leaf, so neutralising it
// poisons nothing else.
mock.module("server-only", () => ({}))

import type { LorebookEntryRecord } from "@/lib/store/records"
import type { ActionResult, NewLorebookEntry } from "@/lib/types"

const STORY_ID = "22222222-2222-4222-8222-222222222222"

const canonical: LorebookEntryRecord = {
  id: "unused — replaced per call",
  storyId: STORY_ID,
  name: "Server Name",
  category: "character",
  keys: ["server"],
  content: "server content",
  enabled: true,
  alwaysActive: false,
  priority: 50,
  createdAt: "2026-08-28T00:00:00.000Z",
  // Strictly newer than any ghost's placeholder, which is the point: this is
  // the server-minted version the whole store arbitrates on.
  updatedAt: "2099-01-01T00:00:00.000Z",
}

const calls: { name: string; args: unknown[] }[] = []

let createResult: ActionResult<{ record: LorebookEntryRecord }> = {
  ok: true,
  data: { record: canonical },
}
let updateResult: ActionResult<{ record: LorebookEntryRecord }> = {
  ok: true,
  data: { record: canonical },
}
let deleteResult: ActionResult<{ storyId: string; version: string }> = {
  ok: true,
  data: { storyId: STORY_ID, version: "2099-01-01T00:00:00.000Z" },
}

const mockedActions = {
  createLorebookEntry: async (
    storyId: string,
    input: NewLorebookEntry,
    options?: { id?: string; origin?: string | null }
  ) => {
    calls.push({ name: "create", args: [storyId, input, options] })
    if (!createResult.ok) return createResult
    // Echo the client's id back, exactly as the real action does.
    return {
      ok: true as const,
      data: { record: { ...canonical, id: options?.id ?? canonical.id } },
    }
  },
  updateLorebookEntry: async (
    id: string,
    patch: Partial<NewLorebookEntry>,
    options?: { origin?: string | null }
  ) => {
    calls.push({ name: "update", args: [id, patch, options] })
    if (!updateResult.ok) return updateResult
    return { ok: true as const, data: { record: { ...canonical, id } } }
  },
  deleteLorebookEntry: async (
    id: string,
    options?: { origin?: string | null }
  ) => {
    calls.push({ name: "delete", args: [id, options] })
    return deleteResult
  },
}

const { clientStore } = await import("@/lib/store/store")
const { mutationQueue } = await import("@/lib/store/mutation-queue")
const mutations = await import("@/lib/store/lorebook-mutations")

function draft(overrides: Partial<NewLorebookEntry> = {}): NewLorebookEntry {
  return {
    name: "Ash",
    category: "character",
    keys: ["ash"],
    content: "A drifter.",
    enabled: true,
    alwaysActive: false,
    priority: 50,
    ...overrides,
  }
}

beforeEach(() => {
  calls.length = 0
  createResult = { ok: true, data: { record: canonical } }
  updateResult = { ok: true, data: { record: canonical } }
  deleteResult = {
    ok: true,
    data: { storyId: STORY_ID, version: "2099-01-01T00:00:00.000Z" },
  }
  mutationQueue.reset()
  clientStore.reset()
  mutations.setLorebookMutationDepsForTests(
    mockedActions as unknown as Parameters<
      typeof mutations.setLorebookMutationDepsForTests
    >[0]
  )
})

afterEach(() => {
  mutations.setLorebookMutationDepsForTests()
})

describe("startLorebookCreate", () => {
  test("the row is in the store before the server is asked", async () => {
    const { id, settled } = mutations.startLorebookCreate(STORY_ID, draft())

    // Synchronously — this is the entire point of the overlay.
    const view = clientStore.getLoreView(STORY_ID)
    expect(view.entries.map((e) => e.id)).toEqual([id])
    expect(view.entries[0]?.name).toBe("Ash")

    await settled
  })

  test("sends the client-minted id, so a retry is idempotent", async () => {
    const { id, settled } = mutations.startLorebookCreate(STORY_ID, draft())
    await settled

    const create = calls.find((c) => c.name === "create")
    expect((create?.args[2] as { id?: string })?.id).toBe(id)
  })

  test("confirming folds the server's record and drops the overlay", async () => {
    const { id, settled } = mutations.startLorebookCreate(STORY_ID, draft())
    await settled

    const view = clientStore.getLoreView(STORY_ID)
    expect(view.entries).toHaveLength(1)
    expect(view.entries[0]?.id).toBe(id)
    // The server's name, not the ghost's — the confirm replaced the row.
    expect(view.entries[0]?.name).toBe("Server Name")
    expect(clientStore.getView().pendingCount).toBe(0)
  })

  test("a refused create rolls the ghost back out", async () => {
    createResult = { ok: false, error: "nope" }
    const { settled } = mutations.startLorebookCreate(STORY_ID, draft())
    const res = await settled

    expect(res.ok).toBe(false)
    expect(clientStore.getLoreView(STORY_ID).entries).toEqual([])
  })

  test("an empty name never reaches the server", async () => {
    const { settled } = mutations.startLorebookCreate(
      STORY_ID,
      draft({ name: "   " })
    )
    const res = await settled

    expect(res.ok).toBe(false)
    expect(calls.find((c) => c.name === "create")).toBeUndefined()
  })
})

describe("updateLorebookEntryOptimistic", () => {
  test("the edit is visible before the server answers", async () => {
    const { id, settled } = mutations.startLorebookCreate(STORY_ID, draft())
    await settled

    const pending = mutations.updateLorebookEntryOptimistic(id, {
      content: "rewritten",
    })
    expect(clientStore.getLoreView(STORY_ID).entries[0]?.content).toBe(
      "rewritten"
    )
    await pending
  })

  test("never sends a version the client minted", async () => {
    const { id, settled } = mutations.startLorebookCreate(STORY_ID, draft())
    await settled
    await mutations.updateLorebookEntryOptimistic(id, { content: "x" })

    const update = calls.find((c) => c.name === "update")
    expect(Object.keys(update?.args[1] as object)).toEqual(["content"])
  })

  test("an empty patch costs no round trip", async () => {
    const { id, settled } = mutations.startLorebookCreate(STORY_ID, draft())
    await settled
    calls.length = 0

    const res = await mutations.updateLorebookEntryOptimistic(id, {})
    expect(res.ok).toBe(true)
    expect(calls).toEqual([])
  })

  test("a blank name is refused locally", async () => {
    const { id, settled } = mutations.startLorebookCreate(STORY_ID, draft())
    await settled
    calls.length = 0

    const res = await mutations.updateLorebookEntryOptimistic(id, { name: " " })
    expect(res.ok).toBe(false)
    expect(calls).toEqual([])
  })

  test("a refused edit rolls back to what the server last confirmed", async () => {
    const { id, settled } = mutations.startLorebookCreate(STORY_ID, draft())
    await settled
    updateResult = { ok: false, error: "nope" }

    const res = await mutations.updateLorebookEntryOptimistic(id, {
      content: "rewritten",
    })

    expect(res.ok).toBe(false)
    expect(clientStore.getLoreView(STORY_ID).entries[0]?.content).toBe(
      "server content"
    )
  })
})

describe("deleteLorebookEntryOptimistic", () => {
  test("the row leaves the list before the server answers", async () => {
    const { id, settled } = mutations.startLorebookCreate(STORY_ID, draft())
    await settled

    const pending = mutations.deleteLorebookEntryOptimistic(id)
    expect(clientStore.getLoreView(STORY_ID).entries).toEqual([])
    await pending
  })

  test("a refused delete puts the row back", async () => {
    const { id, settled } = mutations.startLorebookCreate(STORY_ID, draft())
    await settled
    deleteResult = { ok: false, error: "nope" }

    const res = await mutations.deleteLorebookEntryOptimistic(id)

    expect(res.ok).toBe(false)
    expect(clientStore.getLoreView(STORY_ID).entries.map((e) => e.id)).toEqual([
      id,
    ])
  })

  test("a confirmed delete tombstones the row against a stale upsert", async () => {
    const { id, settled } = mutations.startLorebookCreate(STORY_ID, draft())
    await settled
    await mutations.deleteLorebookEntryOptimistic(id)

    // An upsert older than the deleting clock must not resurrect it.
    clientStore.ingest({
      type: "entity",
      op: "upsert",
      entity: "lorebook-entry",
      id,
      storyId: STORY_ID,
      version: "2030-01-01T00:00:00.000Z",
      origin: null,
      data: { ...canonical, id },
    })

    expect(clientStore.getLoreView(STORY_ID).entries).toEqual([])
  })
})
