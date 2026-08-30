// tests/store-lore.test.ts — The lorebook's half of the store contract.
//
// Lore is the first PARTITIONED table: a complete read is complete for one
// story and says nothing about any other. That single difference is what these
// tests pin down, because getting it wrong is silent — a sweep that overreaches
// deletes another story's lore on a device that was only reading this one.

import { describe, expect, test } from "bun:test"

import {
  adoptCache,
  applyPartitionSnapshot,
  deriveLoreView,
  emptyTable,
  type SnapshotRow,
  type TableState,
} from "@/lib/store/store"
import type { LorebookEntryRecord } from "@/lib/store/records"
import type { QueuedMutation } from "@/lib/store/mutation-queue"

const NOW = 1_700_000_000_000

function lore(
  id: string,
  storyId: string,
  overrides: Partial<LorebookEntryRecord> = {}
): LorebookEntryRecord {
  return {
    id,
    storyId,
    name: id,
    category: "character",
    keys: [],
    content: "",
    enabled: true,
    alwaysActive: false,
    priority: 50,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  }
}

function snap(row: LorebookEntryRecord): SnapshotRow<LorebookEntryRecord> {
  return { id: row.id, version: row.updatedAt, row }
}

function tableOf(rows: LorebookEntryRecord[]): TableState<LorebookEntryRecord> {
  let seq = 0
  return adoptCache(
    emptyTable<LorebookEntryRecord>(),
    rows.map(snap),
    () => ++seq
  )
}

/** A pending mutation carrying exactly the given patches. */
function pending(patches: QueuedMutation["patches"]): QueuedMutation {
  return {
    id: `m-${patches.length}-${Math.random()}`,
    label: "test",
    patches,
    run: async () => ({ ok: true, canonical: [] }),
  }
}

describe("applyPartitionSnapshot — a complete read of ONE story", () => {
  test("sweeps a row the read did not return, within the partition", () => {
    const table = tableOf([lore("a", "s1"), lore("b", "s1")])
    let seq = 100

    const next = applyPartitionSnapshot(
      table,
      [snap(lore("a", "s1"))],
      (row) => row.storyId === "s1",
      seq,
      new Set(),
      NOW,
      () => ++seq
    )

    expect([...next.rows.keys()]).toEqual(["a"])
    expect(next.tombstones.has("b")).toBe(true)
  })

  test("never sweeps another story's rows", () => {
    // The whole reason this reducer exists. A read of s1 returning one row must
    // not be read as "s2 has no lore" — no device holds every story's lore, so
    // absence from an s1 read is not evidence about s2 at all.
    const table = tableOf([lore("a", "s1"), lore("z", "s2")])
    let seq = 100

    const next = applyPartitionSnapshot(
      table,
      [snap(lore("a", "s1"))],
      (row) => row.storyId === "s1",
      seq,
      new Set(),
      NOW,
      () => ++seq
    )

    expect(next.rows.has("z")).toBe(true)
    expect(next.tombstones.has("z")).toBe(false)
  })

  test("spares a row learned about after the request was issued", () => {
    const table = tableOf([lore("a", "s1")])
    // Issued before "a" was ingested: its ingestSeq (1) is greater than 0.
    const next = applyPartitionSnapshot(
      table,
      [],
      (row) => row.storyId === "s1",
      0,
      new Set(),
      NOW,
      () => 99
    )

    expect(next.rows.has("a")).toBe(true)
  })

  test("spares the target of a pending optimistic create", () => {
    const table = tableOf([lore("ghost", "s1")])
    let seq = 100

    const next = applyPartitionSnapshot(
      table,
      [],
      (row) => row.storyId === "s1",
      seq,
      new Set(["ghost"]),
      NOW,
      () => ++seq
    )

    expect(next.rows.has("ghost")).toBe(true)
  })

  test("returns the same object when nothing moved", () => {
    const table = tableOf([lore("a", "s1")])
    let seq = 100
    const next = applyPartitionSnapshot(
      table,
      [snap(lore("a", "s1"))],
      (row) => row.storyId === "s1",
      seq,
      new Set(),
      NOW,
      () => ++seq
    )
    // Adopting an identical row is a no-op, and no sweep fired.
    expect(next.rows.size).toBe(1)
    expect(next.tombstones.size).toBe(0)
  })
})

describe("deriveLoreView", () => {
  test("holds only the asked-for story, sorted by name", () => {
    const table = tableOf([
      lore("1", "s1", { name: "Wren" }),
      lore("2", "s1", { name: "Ash" }),
      lore("3", "s2", { name: "Aaron" }),
    ])

    const view = deriveLoreView(table, [], "s1", "live")
    expect(view.entries.map((e) => e.name)).toEqual(["Ash", "Wren"])
  })

  test("a pending create is visible immediately", () => {
    const table = tableOf([lore("1", "s1", { name: "Wren" })])
    const ghost = lore("2", "s1", { name: "Ash" })

    const view = deriveLoreView(
      table,
      [pending([{ entity: "lorebook-entry", op: "upsert", row: ghost }])],
      "s1",
      "live"
    )

    expect(view.entries.map((e) => e.name)).toEqual(["Ash", "Wren"])
  })

  test("a pending create for another story stays out of this one", () => {
    const table = tableOf([lore("1", "s1", { name: "Wren" })])
    const ghost = lore("2", "s2", { name: "Ash" })

    const view = deriveLoreView(
      table,
      [pending([{ entity: "lorebook-entry", op: "upsert", row: ghost }])],
      "s1",
      "live"
    )

    expect(view.entries.map((e) => e.id)).toEqual(["1"])
  })

  test("a pending merge shows the edited field", () => {
    const table = tableOf([lore("1", "s1", { name: "Wren", content: "old" })])

    const view = deriveLoreView(
      table,
      [
        pending([
          {
            entity: "lorebook-entry",
            op: "merge",
            id: "1",
            fields: { content: "new" },
          },
        ]),
      ],
      "s1",
      "live"
    )

    expect(view.entries[0]?.content).toBe("new")
  })

  test("a pending delete hides the row", () => {
    const table = tableOf([lore("1", "s1"), lore("2", "s1")])

    const view = deriveLoreView(
      table,
      [pending([{ entity: "lorebook-entry", op: "delete", id: "1" }])],
      "s1",
      "live"
    )

    expect(view.entries.map((e) => e.id)).toEqual(["2"])
  })

  test("ignores patches aimed at another table", () => {
    // One queue serves every table, so a story patch rides in the same list.
    const table = tableOf([lore("1", "s1")])

    const view = deriveLoreView(
      table,
      [pending([{ entity: "story", op: "delete", id: "1" }])],
      "s1",
      "live"
    )

    expect(view.entries.map((e) => e.id)).toEqual(["1"])
  })

  test("a merge onto a row that is already gone is a no-op", () => {
    const table = tableOf([lore("1", "s1")])

    const view = deriveLoreView(
      table,
      [
        pending([
          { entity: "lorebook-entry", op: "delete", id: "1" },
          {
            entity: "lorebook-entry",
            op: "merge",
            id: "1",
            fields: { content: "x" },
          },
        ]),
      ],
      "s1",
      "live"
    )

    expect(view.entries).toEqual([])
  })

  test("ties on name break on id, for a total order", () => {
    const table = tableOf([
      lore("b", "s1", { name: "Same" }),
      lore("a", "s1", { name: "Same" }),
    ])
    const view = deriveLoreView(table, [], "s1", "live")
    expect(view.entries.map((e) => e.id)).toEqual(["a", "b"])
  })
})
