import { describe, expect, test } from "bun:test"

import {
  redoPlan,
  undoPlan,
  type EntryMutation,
  type OpPayload,
} from "@/lib/history/ops"
import { MOCK_LOREBOOK_ENTRIES } from "@/lib/mock-data"
import { foldWorld, type WorldEntry, type WorldPatch } from "./fold"
import type { WorldOp } from "@/lib/services/world.schema"

export const NPC = {
  ...MOCK_LOREBOOK_ENTRIES[0],
  id: "npc",
  name: "Vell",
  category: "character" as const,
  npc: true,
}
const entry = (id: string, position: number, isActive = true): WorldEntry => ({
  id,
  position,
  isActive,
  deletedAt: null,
})
const patch = (
  id: string,
  entryId: string | null,
  ops: WorldOp[],
  createdAt = id
): WorldPatch => ({ id, source: "world", entryId, ops, createdAt })
const advance = (minutes: number): WorldOp => ({
  type: "advance-clock",
  minutes,
})
const memory = (id: string, loreEntryId = NPC.id): WorldOp => ({
  type: "add-memory",
  loreEntryId,
  memory: { id, text: `I saw ${id}.`, importance: 3 },
})
function mutate(entries: WorldEntry[], mutations: EntryMutation[]) {
  for (const mutation of mutations) {
    const row = entries.find((e) => e.id === mutation.entryId)!
    if (mutation.type === "set-active") row.isActive = mutation.active
    if (mutation.type === "set-deleted")
      row.deletedAt = mutation.deleted ? "deleted" : null
  }
}

describe("living world fold", () => {
  test("manual corrections follow a late world answer, and later entries still advance from them", () => {
    const patches: WorldPatch[] = [
      {
        ...patch(
          "manual-1",
          "a",
          [
            { type: "set-clock", minutes: 600 },
            { type: "set-mind", loreEntryId: "npc", mind: "Corrected" },
          ],
          "1"
        ),
        source: "manual",
      },
      patch(
        "late",
        "a",
        [
          advance(20),
          { type: "set-mind", loreEntryId: "npc", mind: "Stale" },
          memory("seen"),
        ],
        "9"
      ),
      {
        ...patch(
          "manual-2",
          "a",
          [
            { type: "set-clock", minutes: 720 },
            { type: "strike-memory", loreEntryId: "npc", memoryId: "seen" },
          ],
          "2"
        ),
        source: "manual",
      },
      patch("next", "b", [advance(5)], "0"),
    ]
    for (const order of [patches, patches.toReversed()]) {
      const state = foldWorld("s", [entry("a", 1), entry("b", 2)], [NPC], order)
      expect(state.minutes).toBe(725)
      expect(state.npcs[0]).toMatchObject({ mind: "Corrected", memories: [] })
    }
  })

  test("null anchors precede manuscript position, then creation time; ops use the current clock", () => {
    const state = foldWorld(
      "s",
      [entry("a", 10), entry("b", 20)],
      [NPC],
      [
        patch("b", "b", [advance(7), memory("b")], "0"),
        patch("a2", "a", [advance(3), memory("a")], "2"),
        patch("a1", "a", [{ type: "set-clock", minutes: 12 }], "1"),
        patch("null", null, [advance(5), memory("first")], "9"),
      ]
    )
    expect(state.minutes).toBe(22)
    expect(
      state.npcs[0].memories.map((m) => [m.id, m.minutes, m.entryId])
    ).toEqual([
      ["first", 5, null],
      ["a", 15, "a"],
      ["b", 22, "b"],
    ])
  })

  for (const kind of ["retry", "switch-take"] as const) {
    test(`${kind} swaps the patch and undo/redo restore it`, () => {
      const entries = [entry("old", 1), entry("new", 1, false)]
      const patches = [
        patch("1", "old", [advance(2), memory("old")]),
        patch("2", "new", [advance(20), memory("new")]),
      ]
      const op: OpPayload =
        kind === "retry"
          ? {
              kind,
              variantGroupId: "slot",
              previousEntryId: "old",
              newEntryId: "new",
            }
          : {
              kind,
              variantGroupId: "slot",
              fromEntryId: "old",
              toEntryId: "new",
            }
      const state = () => foldWorld("s", entries, [NPC], patches)
      expect(state().minutes).toBe(2)
      mutate(entries, redoPlan(op))
      expect(state().minutes).toBe(20)
      expect(state().npcs[0].memories.map((m) => m.id)).toEqual(["new"])
      mutate(entries, undoPlan(op))
      expect(state().minutes).toBe(2)
      mutate(entries, redoPlan(op))
      expect(state().minutes).toBe(20)
    })
  }

  test("rewind and its undo remove and restore patches, while null patches always count", () => {
    const entries = [entry("a", 0), entry("b", 1)]
    const patches = [
      patch("0", null, [advance(1)]),
      patch("1", "a", [advance(2)]),
      patch("2", "b", [advance(4)]),
    ]
    const op: OpPayload = { kind: "rewind", entryIds: ["b"] }
    mutate(entries, redoPlan(op))
    expect(foldWorld("s", entries, [NPC], patches).minutes).toBe(3)
    mutate(entries, undoPlan(op))
    expect(foldWorld("s", entries, [NPC], patches).minutes).toBe(7)
    entries[0].deletedAt = "deleted"
    expect(foldWorld("s", entries, [NPC], patches).minutes).toBe(5)
  })

  test("struck memories disappear; mind replaces; deleted and non-NPC ids are ignored", () => {
    const other = { ...NPC, id: "off", npc: false }
    const nonCharacter = { ...NPC, id: "place", category: "location" as const }
    const disabled = { ...NPC, id: "disabled", name: "Ada", enabled: false }
    const state = foldWorld(
      "s",
      [],
      [NPC, other, nonCharacter, disabled],
      [
        patch("1", null, [
          memory("one"),
          memory("two"),
          { type: "strike-memory", loreEntryId: "npc", memoryId: "one" },
          memory("off", "off"),
          memory("gone", "deleted"),
          memory("place", "place"),
          { type: "set-mind", loreEntryId: "npc", mind: "Before" },
          { type: "set-mind", loreEntryId: "npc", mind: "After" },
        ]),
      ]
    )
    expect(state.npcs.map((npc) => npc.name)).toEqual(["Ada", "Vell"])
    expect(state.npcs[0].memories).toEqual([])
    expect(state.npcs[1].mind).toBe("After")
    expect(state.npcs[1].memories.map((m) => m.id)).toEqual(["two"])
    expect(
      foldWorld("s", [], [], [patch("1", null, [memory("gone")])]).npcs
    ).toEqual([])
  })

  test("input order and objects are not mutated; missing anchors do not count", () => {
    const patches = [
      patch("2", "missing", [advance(100)]),
      patch("1", null, [memory("one")]),
    ]
    const before = JSON.stringify(patches)
    expect(foldWorld("s", [], [NPC], patches).minutes).toBe(0)
    expect(JSON.stringify(patches)).toBe(before)
  })
})
