// tests/store-core.test.ts — The LWW reducers ARE the convergence contract
// between two devices, and these tests are the only place it is written down
// executably. Each of design doc §3.2's numbered rules gets its own test, in
// order, including the two that look like typos until you know why: events
// arbitrate on strict `>` and snapshots on `>=`.

import { describe, expect, test } from "bun:test"

import {
  TOMBSTONE_TTL_MS,
  adoptCache,
  adoptDelete,
  adoptUpsert,
  applyScopedResult,
  applySnapshot,
  emptyTable,
  type SnapshotRow,
  type TableState,
} from "@/lib/store/store"
import type { StoryRecord } from "@/lib/store/records"

const NOW = 1_700_000_000_000

function story(id: string, overrides: Partial<StoryRecord> = {}): StoryRecord {
  return {
    id,
    title: "A Story",
    description: "",
    genre: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    wordCount: 0,
    tintHue: null,
    tintStrength: 1,
    tintAuto: true,
    ...overrides,
  }
}

function snap(
  id: string,
  version: string,
  overrides: Partial<StoryRecord> = {}
): SnapshotRow<StoryRecord> {
  return {
    id,
    version,
    row: story(id, { updatedAt: version, ...overrides }),
  }
}

/** A seq allocator whose values a test can reason about. */
function counter(start = 0): () => number {
  let n = start
  return () => ++n
}

function seeded(
  rows: Array<[string, string, number]>,
  status: TableState<StoryRecord>["status"] = "live"
): TableState<StoryRecord> {
  const table = emptyTable<StoryRecord>()
  for (const [id, version, seq] of rows) {
    table.rows.set(id, {
      row: story(id, { updatedAt: version }),
      version,
      ingestSeq: seq,
    })
  }
  return { ...table, status }
}

describe("rule 1 — event upsert arbitrates on strict >", () => {
  test("adopts into an empty table", () => {
    const next = adoptUpsert(
      emptyTable<StoryRecord>(),
      "a",
      "2026-08-02T00:00:00.000Z",
      story("a"),
      1
    )
    expect(next.rows.get("a")?.version).toBe("2026-08-02T00:00:00.000Z")
    expect(next.rows.get("a")?.ingestSeq).toBe(1)
  })

  test("refuses a stale event", () => {
    const table = seeded([["a", "2026-08-05T00:00:00.000Z", 1]])
    const next = adoptUpsert(
      table,
      "a",
      "2026-08-04T00:00:00.000Z",
      story("a", { title: "Stale" }),
      2
    )
    expect(next).toBe(table)
  })

  test("refuses an equal-version event as our own echo", () => {
    const table = seeded([["a", "2026-08-05T00:00:00.000Z", 1]])
    const next = adoptUpsert(
      table,
      "a",
      "2026-08-05T00:00:00.000Z",
      story("a", { title: "Echo" }),
      2
    )
    expect(next).toBe(table)
    expect(next.rows.get("a")?.row.title).toBe("A Story")
  })
})

describe("rule 2 — upsert versus tombstone", () => {
  test("a tombstone at or past the upsert's version blocks it", () => {
    const table = adoptDelete(
      seeded([["a", "2026-08-05T00:00:00.000Z", 1]]),
      "a",
      "2026-08-06T00:00:00.000Z",
      NOW
    )
    const stale = adoptUpsert(
      table,
      "a",
      "2026-08-06T00:00:00.000Z",
      story("a"),
      2
    )
    expect(stale).toBe(table)
    expect(stale.rows.has("a")).toBe(false)
  })

  test("a strictly newer upsert resurrects and clears the tombstone", () => {
    const table = adoptDelete(
      seeded([["a", "2026-08-05T00:00:00.000Z", 1]]),
      "a",
      "2026-08-06T00:00:00.000Z",
      NOW
    )
    const next = adoptUpsert(
      table,
      "a",
      "2026-08-07T00:00:00.000Z",
      story("a", { title: "Back" }),
      2
    )
    expect(next.rows.get("a")?.row.title).toBe("Back")
    expect(next.tombstones.has("a")).toBe(false)
  })

  test("a tombstone blocks a SNAPSHOT row too", () => {
    const table = adoptDelete(
      seeded([["a", "2026-08-05T00:00:00.000Z", 1]]),
      "a",
      "2026-08-06T00:00:00.000Z",
      NOW
    )
    const next = applySnapshot(
      table,
      [snap("a", "2026-08-06T00:00:00.000Z")],
      new Set(["a"]),
      10,
      new Set(),
      NOW,
      counter()
    )
    expect(next.rows.has("a")).toBe(false)
  })
})

describe("rule 3 — event delete", () => {
  test("delete then a stale upsert stays dead", () => {
    let table = seeded([["a", "2026-08-05T00:00:00.000Z", 1]])
    table = adoptDelete(table, "a", "2026-08-06T00:00:00.000Z", NOW)
    table = adoptUpsert(table, "a", "2026-08-05T00:00:00.000Z", story("a"), 5)
    expect(table.rows.has("a")).toBe(false)
    expect(table.tombstones.get("a")?.version).toBe("2026-08-06T00:00:00.000Z")
  })

  test("keeps the newer of an existing tombstone and the event", () => {
    let table = adoptDelete(
      emptyTable<StoryRecord>(),
      "a",
      "2026-08-09T00:00:00.000Z",
      NOW
    )
    table = adoptDelete(table, "a", "2026-08-07T00:00:00.000Z", NOW + 1)
    expect(table.tombstones.get("a")?.version).toBe("2026-08-09T00:00:00.000Z")
  })
})

describe("rule 4 — complete snapshot apply", () => {
  test("adopts an equal-version row: the divergence heal", () => {
    // Same version, different content — impossible with the atomic mint, which
    // is exactly why the snapshot is allowed to overwrite it: server truth
    // repairs a client that got there some other way instead of being refused
    // forever by the event rule.
    const table = seeded([["a", "2026-08-05T00:00:00.000Z", 1]])
    const next = applySnapshot(
      table,
      [snap("a", "2026-08-05T00:00:00.000Z", { title: "Server truth" })],
      new Set(["a"]),
      10,
      new Set(),
      NOW,
      counter()
    )
    expect(next.rows.get("a")?.row.title).toBe("Server truth")
  })

  test("still refuses a strictly older snapshot row", () => {
    const table = seeded([["a", "2026-08-05T00:00:00.000Z", 1]])
    const next = applySnapshot(
      table,
      [snap("a", "2026-08-04T00:00:00.000Z", { title: "Older" })],
      new Set(["a"]),
      10,
      new Set(),
      NOW,
      counter()
    )
    expect(next.rows.get("a")?.row.title).toBe("A Story")
  })

  test("sweeps rows absent from allIds and tombstones them at their own version", () => {
    const table = seeded([
      ["a", "2026-08-05T00:00:00.000Z", 1],
      ["gone", "2026-08-03T00:00:00.000Z", 2],
    ])
    const next = applySnapshot(
      table,
      [snap("a", "2026-08-05T00:00:00.000Z")],
      new Set(["a"]),
      10,
      new Set(),
      NOW,
      counter()
    )
    expect(next.rows.has("gone")).toBe(false)
    expect(next.tombstones.get("gone")).toEqual({
      version: "2026-08-03T00:00:00.000Z",
      at: NOW,
    })
  })

  test("spares protectedIds — a pending create the server has not seen yet", () => {
    const table = seeded([["ghost", "2026-08-05T00:00:00.000Z", 1]])
    const next = applySnapshot(
      table,
      [],
      new Set(),
      10,
      new Set(["ghost"]),
      NOW,
      counter()
    )
    expect(next.rows.has("ghost")).toBe(true)
    expect(next.tombstones.has("ghost")).toBe(false)
  })

  test("spares a row learned about while the request was in flight", () => {
    // issueSeq captured at 10; an entity event lands at seq 11 before the
    // response does, so the snapshot's silence about it proves nothing.
    const issueSeq = 10
    let table = seeded([["a", "2026-08-05T00:00:00.000Z", 5]])
    table = adoptUpsert(
      table,
      "fresh",
      "2026-08-06T00:00:00.000Z",
      story("fresh"),
      issueSeq + 1
    )
    const next = applySnapshot(
      table,
      [snap("a", "2026-08-05T00:00:00.000Z")],
      new Set(["a"]),
      issueSeq,
      new Set(),
      NOW,
      counter(20)
    )
    expect(next.rows.has("fresh")).toBe(true)
  })

  test("GCs tombstones past the TTL and keeps the young ones", () => {
    let table = emptyTable<StoryRecord>()
    table = adoptDelete(table, "old", "2026-08-01T00:00:00.000Z", NOW)
    table = adoptDelete(table, "young", "2026-08-01T00:00:00.000Z", NOW)
    table.tombstones.set("old", {
      version: "2026-08-01T00:00:00.000Z",
      at: NOW - TOMBSTONE_TTL_MS - 1,
    })
    const next = applySnapshot(
      table,
      [],
      new Set(),
      10,
      new Set(),
      NOW,
      counter()
    )
    expect(next.tombstones.has("old")).toBe(false)
    expect(next.tombstones.has("young")).toBe(true)
  })

  test("promotes the table to live", () => {
    const next = applySnapshot(
      emptyTable<StoryRecord>(),
      [snap("a", "2026-08-05T00:00:00.000Z")],
      new Set(["a"]),
      0,
      new Set(),
      NOW,
      counter()
    )
    expect(next.status).toBe("live")
  })
})

describe("rule 5 — scoped apply", () => {
  test("an asked-for id with no row is a delete when it predates the issue", () => {
    const table = seeded([["a", "2026-08-05T00:00:00.000Z", 3]])
    const next = applyScopedResult(table, ["a"], [], 10, NOW, counter(20))
    expect(next.rows.has("a")).toBe(false)
    expect(next.tombstones.get("a")?.version).toBe("2026-08-05T00:00:00.000Z")
  })

  test("an id learned about after the issue survives an empty result", () => {
    const table = seeded([["a", "2026-08-05T00:00:00.000Z", 11]])
    const next = applyScopedResult(table, ["a"], [], 10, NOW, counter(20))
    expect(next.rows.has("a")).toBe(true)
    expect(next).toBe(table)
  })

  test("adopts a returned row on >= and leaves status alone", () => {
    const table = seeded([["a", "2026-08-05T00:00:00.000Z", 1]], "cache")
    const next = applyScopedResult(
      table,
      ["a"],
      [snap("a", "2026-08-05T00:00:00.000Z", { title: "Healed" })],
      10,
      NOW,
      counter(20)
    )
    expect(next.rows.get("a")?.row.title).toBe("Healed")
    expect(next.status).toBe("cache")
  })
})

describe("rule 7 — cache adoption and the status ladder", () => {
  test("empty -> cache -> live", () => {
    const cached = adoptCache(
      emptyTable<StoryRecord>(),
      [snap("a", "2026-08-05T00:00:00.000Z")],
      counter()
    )
    expect(cached.status).toBe("cache")
    const live = applySnapshot(
      cached,
      [snap("a", "2026-08-05T00:00:00.000Z")],
      new Set(["a"]),
      0,
      new Set(),
      NOW,
      counter(10)
    )
    expect(live.status).toBe("live")
  })

  test("never downgrades live, and never overwrites at an equal version", () => {
    const live = applySnapshot(
      emptyTable<StoryRecord>(),
      [snap("a", "2026-08-05T00:00:00.000Z")],
      new Set(["a"]),
      0,
      new Set(),
      NOW,
      counter()
    )
    const next = adoptCache(
      live,
      [snap("a", "2026-08-05T00:00:00.000Z", { title: "Stale cache" })],
      counter(10)
    )
    expect(next.status).toBe("live")
    expect(next.rows.get("a")?.row.title).toBe("A Story")
  })
})

describe("same-object returns", () => {
  test("every reducer returns the input when nothing moved", () => {
    const table = seeded([["a", "2026-08-05T00:00:00.000Z", 1]])
    const allIds = new Set(["a"])
    expect(
      adoptUpsert(table, "a", "2026-08-05T00:00:00.000Z", story("a"), 2)
    ).toBe(table)
    expect(
      applySnapshot(
        table,
        [snap("a", "2026-08-04T00:00:00.000Z")],
        allIds,
        10,
        new Set(),
        NOW,
        counter()
      )
    ).toBe(table)
    expect(
      applyScopedResult(
        table,
        ["a"],
        [snap("a", "2026-08-04T00:00:00.000Z")],
        10,
        NOW,
        counter()
      )
    ).toBe(table)
    expect(
      adoptCache(table, [snap("a", "2026-08-04T00:00:00.000Z")], counter())
    ).toBe(table)
  })
})
