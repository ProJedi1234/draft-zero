// tests/store-records.test.ts — The two pure pieces of the store's record
// layer. Small, and load-bearing out of proportion to their size:
// isValidEntityId is the ONLY guard between a client-minted id and a primary
// key (a create names its own row so a retried write is idempotent), and
// toStoryRecord is the single projection every sidebar row, library card and
// entity event is built from — a field dropped here goes missing everywhere at
// once, with no type error to catch it.

import { describe, expect, test } from "bun:test"

import type { StoryRow } from "@/lib/db/schema"
import { isValidEntityId, toStoryRecord } from "@/lib/store/records"
import { randomId } from "@/lib/id"

describe("isValidEntityId", () => {
  test("accepts a freshly minted id", () => {
    expect(isValidEntityId(randomId())).toBe(true)
  })

  test("accepts uppercase hex", () => {
    expect(isValidEntityId("3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe(true)
  })

  // Rows predating randomId() carry slugs, and they are renamed through the
  // same guard as a freshly minted UUID.
  test("accepts a legacy slug id", () => {
    expect(isValidEntityId("story-cartographer")).toBe(true)
    expect(isValidEntityId("story_untitled_2")).toBe(true)
  })

  test("rejects empty and over-long ids", () => {
    expect(isValidEntityId("")).toBe(false)
    expect(isValidEntityId("a".repeat(129))).toBe(false)
  })

  test("rejects ids carrying path or wildcard characters", () => {
    for (const id of [
      "../../etc/passwd",
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301/../x",
      "%",
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301 or 1=1",
    ]) {
      expect(isValidEntityId(id)).toBe(false)
    }
  })
})

function storyRow(overrides: Partial<StoryRow> = {}): StoryRow {
  return {
    id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    title: "The Salt Road",
    description: "A caravan, a debt.",
    genre: "fantasy",
    memory: "remembered",
    authorsNote: "note",
    systemPrompt: null,
    profileId: null,
    modelId: "anthropic/claude-sonnet-5",
    thinking: "off",
    providerTag: null,
    zdr: false,
    imageModelId: null,
    temperature: 0.9,
    topP: 0.95,
    contextWindow: 8192,
    loreBudget: 25,
    frequencyPenalty: 0.15,
    presencePenalty: 0.1,
    summarize: true,
    tintHue: 210,
    tintStrength: 0.6,
    tintAuto: false,
    undoCursor: 3,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-27T09:30:00.000Z",
    ...overrides,
  }
}

describe("toStoryRecord", () => {
  test("maps every projected field and passes the word count through", () => {
    expect(toStoryRecord(storyRow(), 4212)).toEqual({
      id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      title: "The Salt Road",
      description: "A caravan, a debt.",
      genre: "fantasy",
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-27T09:30:00.000Z",
      wordCount: 4212,
      tintHue: 210,
      tintStrength: 0.6,
      tintAuto: false,
    })
  })

  test("preserves a null tint hue rather than collapsing it to 0", () => {
    // 0 is red; "untinted" is not a hue. See the tint_hue column comment.
    expect(toStoryRecord(storyRow({ tintHue: null }), 0).tintHue).toBeNull()
  })

  test("carries none of the generation settings the library never shows", () => {
    const record: Record<string, unknown> = { ...toStoryRecord(storyRow(), 0) }
    for (const key of ["memory", "systemPrompt", "modelId", "undoCursor"]) {
      expect(key in record).toBe(false)
    }
  })
})
