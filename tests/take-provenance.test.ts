// tests/take-provenance.test.ts — What a slot of takes says about who wrote it.
//
// The rule the switcher hangs on: a take's profile is worth naming under the
// prose only when the slot's takes DISAGREE about which profile wrote them.
// Pinned here rather than in the component because it is the whole feature in
// one predicate — retrying under another profile is only legible if the
// manuscript can afterwards tell you which take came from where.

import { describe, expect, test } from "bun:test"

import { slotProfilesMixed, toStoryEntry } from "@/lib/db/mappers"
import type { StoryEntryRow } from "@/lib/db/schema"

function take(over: Partial<StoryEntryRow> = {}): StoryEntryRow {
  return {
    id: "entry-1",
    storyId: "story-1",
    position: 1,
    source: "generated",
    text: "The river went still.",
    actionKind: null,
    inputText: null,
    variantGroupId: "slot-1",
    variantIndex: 0,
    isActive: true,
    deletedAt: null,
    genModelId: "~anthropic/claude-sonnet-latest",
    genThinking: "off",
    genTemperature: 1,
    genProfileName: "Quality",
    promptTokens: null,
    completionTokens: null,
    createdAt: "2026-08-20T10:00:00Z",
    ...over,
  }
}

describe("slotProfilesMixed", () => {
  test("a slot of one take never disagrees with itself", () => {
    expect(slotProfilesMixed([take()])).toBe(false)
  })

  test("takes from the same profile are not mixed", () => {
    expect(
      slotProfilesMixed([take(), take({ id: "entry-2", variantIndex: 1 })])
    ).toBe(false)
  })

  test("takes from different profiles are", () => {
    expect(
      slotProfilesMixed([
        take(),
        take({ id: "entry-2", variantIndex: 1, genProfileName: "Swift" }),
      ])
    ).toBe(true)
  })

  // A Custom story records no profile on any take, so its slots are quiet for
  // the same reason a single-profile slot is: there is nothing to distinguish.
  test("takes that all came from a story's own settings are not mixed", () => {
    expect(
      slotProfilesMixed([
        take({ genProfileName: null }),
        take({ id: "entry-2", variantIndex: 1, genProfileName: null }),
      ])
    ).toBe(false)
  })

  // The one asymmetry worth stating: an unnamed take beside a named one IS a
  // disagreement. They were generated from different places, and the writer
  // comparing them is owed that much even though only one half can be named.
  test("an unnamed take beside a named one is mixed", () => {
    expect(
      slotProfilesMixed([
        take({ genProfileName: null }),
        take({ id: "entry-2", variantIndex: 1, genProfileName: "Swift" }),
      ])
    ).toBe(true)
  })
})

describe("toStoryEntry", () => {
  test("carries the profile that wrote the take, and the slot's verdict", () => {
    const entry = toStoryEntry(take({ genProfileName: "Swift" }), {
      index: 1,
      count: 2,
      profilesMixed: true,
    })
    expect(entry.generation?.profileName).toBe("Swift")
    expect(entry.variantProfilesMixed).toBe(true)
  })

  test("a take generated under a story's own settings names no profile", () => {
    const entry = toStoryEntry(take({ genProfileName: null }), {
      index: 0,
      count: 1,
      profilesMixed: false,
    })
    // Not null provenance: the model and temperature were still recorded, and
    // dropping the whole record because one field is absent would lose them.
    expect(entry.generation).not.toBeNull()
    expect(entry.generation?.profileName).toBeNull()
  })

  test("a user passage has no provenance at all", () => {
    const entry = toStoryEntry(
      take({
        source: "user",
        genModelId: null,
        genThinking: null,
        genTemperature: null,
        genProfileName: null,
      }),
      { index: 0, count: 1, profilesMixed: false }
    )
    expect(entry.generation).toBeNull()
  })
})
