// tests/store-view.test.ts — The derived view, which is where the optimistic
// illusion either holds together or doesn't. Two properties carry it: a row a
// pending mutation touched sorts to the top immediately (which is where the
// server's own updatedAt bump will land it a moment later, so nothing jumps on
// confirm), and a merge patch never carries an updatedAt — the client clock
// must not fabricate a value that gets compared against server-minted versions.

import { describe, expect, test } from "bun:test"

import {
  clientStore,
  deriveStoryView,
  emptyTable,
  type TableState,
} from "@/lib/store/store"
import type { QueuedMutation, StorePatch } from "@/lib/store/mutation-queue"
import type { StoryRecord } from "@/lib/store/records"

function story(id: string, updatedAt: string, title = id): StoryRecord {
  return {
    id,
    title,
    description: "",
    genre: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt,
    wordCount: 0,
    tintHue: null,
    tintStrength: 1,
    tintAuto: true,
  }
}

function confirmed(rows: StoryRecord[]): TableState<StoryRecord> {
  const table = emptyTable<StoryRecord>()
  rows.forEach((row, i) => {
    table.rows.set(row.id, { row, version: row.updatedAt, ingestSeq: i + 1 })
  })
  return { ...table, status: "live" }
}

function mutation(id: string, patches: StorePatch[]): QueuedMutation {
  return {
    id,
    label: id,
    patches,
    run: () => Promise.resolve({ ok: true as const, canonical: [] }),
  }
}

describe("deriveStoryView", () => {
  test("sorts untouched rows by updatedAt DESC with an id tiebreak", () => {
    const view = deriveStoryView(
      confirmed([
        story("b", "2026-08-05T00:00:00.000Z"),
        story("a", "2026-08-05T00:00:00.000Z"),
        story("c", "2026-08-09T00:00:00.000Z"),
      ]),
      []
    )
    expect(view.stories.map((s) => s.id)).toEqual(["c", "a", "b"])
    expect(view.stories.every((s) => !s.pending)).toBe(true)
  })

  test("pending-touched rows lead, most recently enqueued first", () => {
    const view = deriveStoryView(
      confirmed([
        story("a", "2026-08-09T00:00:00.000Z"),
        story("b", "2026-08-08T00:00:00.000Z"),
        story("c", "2026-08-07T00:00:00.000Z"),
      ]),
      [
        mutation("m1", [
          { entity: "story", op: "merge", id: "c", fields: { title: "C!" } },
        ]),
        mutation("m2", [
          { entity: "story", op: "merge", id: "b", fields: { title: "B!" } },
        ]),
      ]
    )
    expect(view.stories.map((s) => s.id)).toEqual(["b", "c", "a"])
    expect(view.stories.map((s) => s.pending)).toEqual([true, true, false])
    expect(view.pendingCount).toBe(2)
  })

  test("a merge onto a row a pending delete removed is a no-op", () => {
    const view = deriveStoryView(
      confirmed([story("a", "2026-08-09T00:00:00.000Z")]),
      [
        mutation("m1", [{ entity: "story", op: "delete", id: "a" }]),
        mutation("m2", [
          { entity: "story", op: "merge", id: "a", fields: { title: "Ghost" } },
        ]),
      ]
    )
    expect(view.stories).toEqual([])
    expect(view.storyById.size).toBe(0)
  })

  test("a merge leaves updatedAt as the confirmed row's", () => {
    const view = deriveStoryView(
      confirmed([story("a", "2026-08-09T00:00:00.000Z")]),
      [
        mutation("m1", [
          {
            entity: "story",
            op: "merge",
            id: "a",
            fields: { title: "Renamed" },
          },
        ]),
      ]
    )
    expect(view.stories[0].title).toBe("Renamed")
    expect(view.stories[0].updatedAt).toBe("2026-08-09T00:00:00.000Z")
  })

  test("an upsert patch shows a row the confirmed table has never held", () => {
    const view = deriveStoryView(confirmed([]), [
      mutation("m1", [
        {
          entity: "story",
          op: "upsert",
          row: story("ghost", "2026-08-09T00:00:00.000Z", "Untitled Story"),
        },
      ]),
    ])
    expect(view.stories.map((s) => s.id)).toEqual(["ghost"])
    expect(view.stories[0].pending).toBe(true)
  })

  test("later patches in the same queue win over earlier ones", () => {
    const view = deriveStoryView(
      confirmed([story("a", "2026-08-09T00:00:00.000Z")]),
      [
        mutation("m1", [
          { entity: "story", op: "merge", id: "a", fields: { title: "One" } },
        ]),
        mutation("m2", [
          { entity: "story", op: "merge", id: "a", fields: { title: "Two" } },
        ]),
      ]
    )
    expect(view.stories[0].title).toBe("Two")
  })
})

describe("clientStore.getView", () => {
  test("returns the same object until something moves", () => {
    clientStore.reset()
    clientStore.applySnapshot(
      [
        {
          id: "a",
          version: "2026-08-09T00:00:00.000Z",
          row: story("a", "2026-08-09T00:00:00.000Z"),
        },
      ],
      new Set(["a"]),
      0
    )
    const first = clientStore.getView()
    expect(clientStore.getView()).toBe(first)

    // A refused stale event must not even invalidate the cache.
    clientStore.ingest({
      type: "entity",
      op: "upsert",
      entity: "story",
      id: "a",
      storyId: "a",
      version: "2026-08-08T00:00:00.000Z",
      origin: null,
      data: story("a", "2026-08-08T00:00:00.000Z", "Stale"),
    })
    expect(clientStore.getView()).toBe(first)

    clientStore.ingest({
      type: "entity",
      op: "upsert",
      entity: "story",
      id: "a",
      storyId: "a",
      version: "2026-08-10T00:00:00.000Z",
      origin: null,
      data: story("a", "2026-08-10T00:00:00.000Z", "Fresh"),
    })
    const second = clientStore.getView()
    expect(second).not.toBe(first)
    expect(second.stories[0].title).toBe("Fresh")
    clientStore.reset()
  })

  test("ignores entity kinds slice 1 does not hold", () => {
    clientStore.reset()
    clientStore.ingest({
      type: "entity",
      op: "upsert",
      entity: "model-profile",
      id: "p1",
      storyId: null,
      version: "2026-08-10T00:00:00.000Z",
      origin: null,
      data: {
        id: "p1",
        name: "Fast",
        sortOrder: 0,
        modelId: "m",
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
    })
    expect(clientStore.getView().stories).toEqual([])
    clientStore.reset()
  })
})
