// tests/story-window.test.ts — The canvas' older-page merge.

import { describe, expect, test } from "bun:test"

import { mergeWindowedEntries } from "@/lib/story-window"
import type { StoryEntry } from "@/lib/types"

function entry(id: string): StoryEntry {
  return {
    id,
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
