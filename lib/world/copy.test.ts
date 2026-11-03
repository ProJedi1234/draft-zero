import { expect, test } from "bun:test"

import type { LorebookEntry } from "@/lib/types"
import { copyWorldPatches } from "./copy"
import { foldWorld, type WorldPatch } from "./fold"

const AT = "2026-10-01T00:00:00.000Z"
const npc = (id: string) =>
  ({ id, name: "Vell", category: "character", npc: true }) as LorebookEntry

function fold(
  storyId: string,
  loreId: string,
  rows: ReturnType<typeof copyWorldPatches>
) {
  const patches: WorldPatch[] = rows.map((row) => ({
    ...row,
    ops: JSON.parse(row.opsJson),
  }))
  return foldWorld(storyId, [], [npc(loreId)], patches)
}

test("a copy keeps the fold order of patches with tied timestamps", () => {
  const memory = { id: "m1", text: "A bell rang.", importance: 3 }
  // All four tie on createdAt, so the fold orders them by id: a, b, c, d.
  const rows = [
    { id: "c", ops: [{ type: "set-clock", minutes: 30 }] },
    {
      id: "b",
      ops: [{ type: "strike-memory", loreEntryId: "l1", memoryId: "m1" }],
    },
    { id: "a", ops: [{ type: "add-memory", loreEntryId: "l1", memory }] },
    { id: "d", ops: [{ type: "set-clock", minutes: 90 }] },
  ].map((row) => ({
    id: row.id,
    entryId: null,
    source: "manual" as const,
    opsJson: JSON.stringify(row.ops),
    createdAt: AT,
  }))
  const original = fold(
    "s1",
    "l1",
    rows.map((row) => ({ ...row, storyId: "s1" }))
  )
  expect(original.minutes).toBe(90)
  expect(original.npcs[0].memories).toEqual([])

  for (let i = 0; i < 50; i++) {
    const copied = copyWorldPatches(
      rows,
      "s2",
      new Map(),
      new Map([["l1", "l2"]])
    )
    const state = fold("s2", "l2", copied)
    expect(state.minutes).toBe(original.minutes)
    expect(state.npcs[0].memories).toEqual([])
  }
})

test("patches on passages the copy left behind are dropped", () => {
  const rows = [
    {
      id: "p1",
      entryId: "kept",
      source: "world" as const,
      opsJson: '[{"type":"advance-clock","minutes":5}]',
      createdAt: AT,
    },
    {
      id: "p2",
      entryId: "gone",
      source: "world" as const,
      opsJson: '[{"type":"advance-clock","minutes":600}]',
      createdAt: AT,
    },
    {
      id: "p3",
      entryId: null,
      source: "manual" as const,
      opsJson: "not json",
      createdAt: AT,
    },
  ]
  const copied = copyWorldPatches(
    rows,
    "s2",
    new Map([["kept", "k2"]]),
    new Map()
  )
  expect(copied.map((row) => row.entryId)).toEqual(["k2"])
})
