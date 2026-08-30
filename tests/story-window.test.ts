// tests/story-window.test.ts — The canvas' older-page merge and reconcile.

import { describe, expect, test } from "bun:test"

import { mergeWindowedEntries, reconcileHeldEntries } from "@/lib/story-window"
import type { StoryEntry } from "@/lib/types"

function entry(id: string, position?: number): StoryEntry {
  return {
    id,
    position,
    source: "generated",
    text: `Passage ${id}.`,
    actionKind: null,
    inputText: null,
    variantGroupId: `group-${id}`,
    variantIndex: 0,
    variantCount: 1,
    variantProfilesMixed: false,
    generation: null,
    costUsd: null,
    reasoningTokens: null,
    callStatus: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  }
}

const ids = (entries: StoryEntry[]) => entries.map((e) => e.id)

describe("mergeWindowedEntries", () => {
  test("no older pages is the tail itself", () => {
    const tail = [entry("c"), entry("d")]
    expect(mergeWindowedEntries([], tail)).toBe(tail)
  })

  test("disjoint pages prepend in order", () => {
    const merged = mergeWindowedEntries(
      [entry("a"), entry("b")],
      [entry("c"), entry("d")]
    )
    expect(ids(merged)).toEqual(["a", "b", "c", "d"])
  })

  test("the tail's copy wins an overlap", () => {
    const older = [entry("a"), { ...entry("b"), text: "stale copy" }]
    const tail = [{ ...entry("b"), text: "fresh copy" }, entry("c")]
    const merged = mergeWindowedEntries(older, tail)
    expect(ids(merged)).toEqual(["a", "b", "c"])
    expect(merged[1].text).toBe("fresh copy")
  })

  test("a fully-swallowed older set leaves only the tail", () => {
    const older = [entry("a"), entry("b")]
    const tail = [entry("a"), entry("b"), entry("c")]
    expect(ids(mergeWindowedEntries(older, tail))).toEqual(["a", "b", "c"])
  })
})

describe("reconcileHeldEntries", () => {
  test("the read is authoritative for the range it covers", () => {
    const held = [entry("a", 10), entry("b", 11)]
    const page = [
      { ...entry("a", 10), text: "edited elsewhere" },
      entry("b", 11),
    ]
    const out = reconcileHeldEntries(held, page, 10)
    expect(ids(out)).toEqual(["a", "b"])
    expect(out[0].text).toBe("edited elsewhere")
  })

  test("a rewind's cut passages leave the held pages", () => {
    // The reader scrolled up and rewound to `b`; `c` and `d` are gone, so the
    // re-read of the same range comes back without them.
    const held = [
      entry("a", 10),
      entry("b", 11),
      entry("c", 12),
      entry("d", 13),
    ]
    const out = reconcileHeldEntries(held, [entry("a", 10), entry("b", 11)], 10)
    expect(ids(out)).toEqual(["a", "b"])
  })

  test("undoing that rewind puts them back", () => {
    const held = [entry("a", 10), entry("b", 11)]
    const restored = [
      entry("a", 10),
      entry("b", 11),
      entry("c", 12),
      entry("d", 13),
    ]
    expect(ids(reconcileHeldEntries(held, restored, 10))).toEqual([
      "a",
      "b",
      "c",
      "d",
    ])
  })

  test("prose below the read's floor is kept untouched", () => {
    // A page landed while the re-read was in flight. It sits below the range
    // that was actually read, and absence there proves nothing — this is the
    // case the old count-sized replacement threw away.
    const held = [entry("x", 4), entry("y", 5), entry("a", 10)]
    const out = reconcileHeldEntries(held, [entry("a", 10)], 10)
    expect(ids(out)).toEqual(["x", "y", "a"])
  })

  test("an empty read empties the held range", () => {
    const held = [entry("a", 10), entry("b", 11)]
    expect(reconcileHeldEntries(held, [], null)).toEqual([])
  })

  test("positionless fixture entries are never dropped", () => {
    const held = [entry("a"), entry("b")]
    expect(ids(reconcileHeldEntries(held, [], null))).toEqual(["a", "b"])
  })
})
