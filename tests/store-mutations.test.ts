// tests/store-mutations.test.ts — What the optimistic story mutations put in
// the overlay, what they send, and what they fold back. The server actions are
// mocked away: the DB-touching half is not unit-tested here, only the shaping.
import { beforeEach, describe, expect, mock, test } from "bun:test"

import type { StoryRecord } from "@/lib/store/records"
import type { StoryView, TableStatus } from "@/lib/store/store"
import type { ActionResult, StorySummary } from "@/lib/types"

/* -------------------------------------------------------------------------- */
/* Mocks — declared before importing the modules under test                   */
/* -------------------------------------------------------------------------- */

const canonical: StoryRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Server Title",
  description: "server description",
  genre: "server genre",
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:05.000Z",
  wordCount: 42,
  tintHue: 200,
  tintStrength: 0.5,
  tintAuto: false,
}

interface CreateInput {
  title?: string
  id?: string
  origin?: string
}

const calls: { name: string; args: unknown[] }[] = []

function record<T>(name: string, result: T) {
  return async (...args: unknown[]): Promise<T> => {
    calls.push({ name, args })
    return result
  }
}

const createStoryMock = mock(
  record<ActionResult<{ id: string; record: StoryRecord }>>("createStory", {
    ok: true,
    data: { id: canonical.id, record: canonical },
  })
)
const updateStoryMetaMock = mock(
  record<ActionResult<{ record: StoryRecord }>>("updateStoryMeta", {
    ok: true,
    data: { record: canonical },
  })
)
const updateStoryTintMock = mock(
  record<ActionResult<{ record: StoryRecord }>>("updateStoryTint", {
    ok: true,
    data: { record: canonical },
  })
)
const setStoryTintAutoMock = mock(
  record<ActionResult<{ record: StoryRecord }>>("setStoryTintAuto", {
    ok: true,
    data: { record: canonical },
  })
)
const deleteStoryMock = mock(
  record<ActionResult>("deleteStory", { ok: true, data: null })
)
const duplicateStoryMock = mock(
  record<ActionResult<{ id: string; record: StoryRecord }>>("duplicateStory", {
    ok: true,
    data: { id: canonical.id, record: canonical },
  })
)

mock.module("@/lib/actions/stories", () => ({
  createStory: createStoryMock as unknown as (
    input?: CreateInput
  ) => Promise<ActionResult<{ id: string; record: StoryRecord }>>,
  updateStoryMeta: updateStoryMetaMock,
  updateStoryTint: updateStoryTintMock,
  setStoryTintAuto: setStoryTintAutoMock,
  deleteStory: deleteStoryMock,
  duplicateStory: duplicateStoryMock,
}))

const { filterStories, showLibrarySkeleton } = await import("@/hooks/use-store")
const { clientStore } = await import("@/lib/store/store")
const { mutationQueue } = await import("@/lib/store/mutation-queue")
const mutations = await import("@/lib/store/story-mutations")

const STORY_ID = "22222222-2222-4222-8222-222222222222"

beforeEach(() => {
  calls.length = 0
  mutationQueue.reset()
  clientStore.reset()
  mutations.setStoryMutationDepsForTests()
})

function lastCall(name: string): unknown[] {
  const found = [...calls].reverse().find((call) => call.name === name)
  if (found === undefined) throw new Error(`${name} was never called`)
  return found.args
}

function pendingPatches() {
  return clientStore.getState().pending.flatMap((m) => m.patches)
}

/* -------------------------------------------------------------------------- */

describe("validation short-circuits", () => {
  test("an empty title never enqueues", async () => {
    const res = await mutations.updateStoryMetaOptimistic(STORY_ID, {
      title: "   ",
    })
    expect(res).toEqual({ ok: false, error: "Title can't be empty." })
    expect(calls).toHaveLength(0)
    expect(clientStore.getState().pending).toHaveLength(0)
  })

  test("a non-uuid id never enqueues", async () => {
    const res = await mutations.deleteStoryOptimistic("../../etc/passwd")
    expect(res).toEqual({ ok: false, error: "Invalid story id." })
    expect(calls).toHaveLength(0)
  })
})

describe("optimistic patch shapes", () => {
  test("the create ghost is a field-complete row, visible before the action resolves", async () => {
    let release = (): void => {}
    mutations.setStoryMutationDepsForTests({
      createStory: (async (input?: CreateInput) => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        calls.push({ name: "createStory", args: [input] })
        return {
          ok: true as const,
          data: { id: input!.id!, record: canonical },
        }
      }) as never,
    })

    const promise = mutations.createStoryOptimistic()

    const view = clientStore.getView()
    expect(view.stories).toHaveLength(1)
    const ghost = view.stories[0]!
    expect(ghost.pending).toBe(true)
    expect(ghost.title).toBe("Untitled Story")
    expect(ghost.wordCount).toBe(0)
    expect(ghost.tintHue).toBeNull()
    expect(ghost.tintStrength).toBe(1)
    expect(ghost.tintAuto).toBe(true)
    // Field-complete: it is rendered by the same components a confirmed row is.
    expect(Object.keys(ghost).sort()).toEqual(
      [
        "createdAt",
        "description",
        "genre",
        "id",
        "pending",
        "tintAuto",
        "tintHue",
        "tintStrength",
        "title",
        "updatedAt",
        "wordCount",
      ].sort()
    )

    release()
    const res = await promise
    expect(res.ok).toBe(true)
  })

  test("a meta merge patches only the given fields and carries no updatedAt", async () => {
    let release = (): void => {}
    mutations.setStoryMutationDepsForTests({
      updateStoryMeta: (async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return { ok: true as const, data: { record: canonical } }
      }) as never,
    })

    const promise = mutations.updateStoryMetaOptimistic(STORY_ID, {
      title: "  Renamed  ",
    })
    const patches = pendingPatches()
    expect(patches).toHaveLength(1)
    const patch = patches[0]!
    expect(patch.op).toBe("merge")
    if (patch.op !== "merge") throw new Error("expected a merge")
    expect(patch.fields).toEqual({ title: "Renamed" })
    expect("updatedAt" in patch.fields).toBe(false)

    release()
    await promise
  })

  test("the duplicate ghost is titled '(copy)' with no words and auto tint", async () => {
    let release = (): void => {}
    mutations.setStoryMutationDepsForTests({
      duplicateStory: (async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return {
          ok: true as const,
          data: { id: canonical.id, record: canonical },
        }
      }) as never,
    })

    const seed: StorySummary = {
      id: STORY_ID,
      title: "Original",
      description: "d",
      genre: "g",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
      wordCount: 900,
      tintHue: 10,
      tintStrength: 0.25,
    }
    const promise = mutations.duplicateStoryOptimistic(STORY_ID, seed)

    const ghost = clientStore.getView().stories[0]!
    expect(ghost.title).toBe("Original (copy)")
    expect(ghost.wordCount).toBe(0)
    expect(ghost.tintAuto).toBe(true)
    expect(ghost.tintHue).toBe(10)
    expect(ghost.id).not.toBe(STORY_ID)

    release()
    await promise
  })

  test("a delete removes the row from the view immediately", async () => {
    clientStore.applySnapshot(
      [
        {
          id: STORY_ID,
          version: "2026-08-01T00:00:00.000Z",
          row: { ...canonical, id: STORY_ID },
        },
      ],
      new Set([STORY_ID]),
      clientStore.currentIngestSeq()
    )
    expect(clientStore.getView().stories).toHaveLength(1)

    let release = (): void => {}
    mutations.setStoryMutationDepsForTests({
      deleteStory: (async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return { ok: true as const, data: null }
      }) as never,
    })

    const promise = mutations.deleteStoryOptimistic(STORY_ID)
    expect(clientStore.getView().stories).toHaveLength(0)

    release()
    await promise
  })
})

describe("clamps mirror the server", () => {
  test("hue wraps into 0..359 and strength clamps to 0..1", async () => {
    await mutations.updateStoryTintOptimistic(STORY_ID, {
      hue: -30.4,
      strength: 4,
    })
    const [, patch] = lastCall("updateStoryTint") as [
      string,
      { hue: number | null; strength?: number },
    ]
    // ((round(-30.4) % 360) + 360) % 360
    expect(patch.hue).toBe(330)
    expect(patch.strength).toBe(1)
  })

  test("a null hue stays null and an absent strength is not sent", async () => {
    await mutations.updateStoryTintOptimistic(STORY_ID, { hue: null })
    const [, patch] = lastCall("updateStoryTint") as [
      string,
      { hue: number | null; strength?: number },
    ]
    expect(patch.hue).toBeNull()
    expect("strength" in patch).toBe(false)
  })
})

describe("canonical mapping", () => {
  test("the action's returned record confirms at its own updatedAt", async () => {
    const res = await mutations.createStoryOptimistic()
    expect(res.ok).toBe(true)

    const created = lastCall("createStory")[0] as CreateInput
    expect(created.id).toBeDefined()
    expect(created.origin).toBeDefined()

    const held = clientStore.getState().story.rows.get(canonical.id)
    expect(held?.version).toBe(canonical.updatedAt)
    expect(held?.row.title).toBe("Server Title")
    expect(clientStore.getState().pending).toHaveLength(0)
  })

  test("a delete confirms as a tombstone", async () => {
    const res = await mutations.deleteStoryOptimistic(STORY_ID)
    expect(res.ok).toBe(true)
    expect(clientStore.getState().story.tombstones.has(STORY_ID)).toBe(true)
  })

  test("a server rejection rolls the overlay back and reports the error", async () => {
    mutations.setStoryMutationDepsForTests({
      updateStoryMeta: (async () => ({
        ok: false as const,
        error: "Story not found.",
      })) as never,
    })
    const res = await mutations.updateStoryMetaOptimistic(STORY_ID, {
      title: "Renamed",
    })
    expect(res).toEqual({ ok: false, error: "Story not found." })
    expect(clientStore.getState().pending).toHaveLength(0)
  })
})

describe("filterStories", () => {
  const rows: StoryView[] = [
    view({ id: "a", title: "The Long Dark", genre: "horror", description: "" }),
    view({
      id: "b",
      title: "Sunrise",
      genre: "romance",
      description: "a dark room",
    }),
    view({ id: "c", title: "Ledger", genre: "", description: "" }),
  ]

  test("an empty query returns the rows themselves", () => {
    expect(filterStories(rows, "   ")).toBe(rows)
  })

  test("it matches title, genre and description, case-insensitively", () => {
    expect(filterStories(rows, "DARK").map((r) => r.id)).toEqual(["a", "b"])
    expect(filterStories(rows, "romance").map((r) => r.id)).toEqual(["b"])
    expect(filterStories(rows, "zzz")).toHaveLength(0)
  })
})

describe("showLibrarySkeleton", () => {
  const cases: Array<[number, TableStatus, boolean]> = [
    [0, "empty", true],
    [0, "cache", true],
    [0, "live", false],
    [1, "empty", false],
    [1, "live", false],
  ]
  for (const [count, status, expected] of cases) {
    test(`${count} rows + ${status} → ${expected}`, () => {
      expect(showLibrarySkeleton(new Array(count).fill(null), status)).toBe(
        expected
      )
    })
  }
})

function view(patch: Partial<StoryView> & { id: string }): StoryView {
  return { ...canonical, pending: false, ...patch }
}
