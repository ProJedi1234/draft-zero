// tests/composer-draft.test.ts — the specification for shouldAdoptDraft: which
// incoming `draft` events a mounted composer writes into its textarea.

import { describe, expect, test } from "bun:test"

import { shouldAdoptDraft, type DraftPayload } from "@/lib/sync/draft"
import type { DraftEvent } from "@/lib/sync/client"

const event = (overrides: Partial<DraftEvent> = {}): DraftEvent => ({
  type: "draft",
  storyId: "s1",
  text: "the door creaks open",
  mode: "do",
  version: "2026-08-28T12:00:10.000Z",
  origin: "other-device",
  ...overrides,
})

const ctx = {
  storyId: "s1",
  selfOrigin: "this-device",
  pending: null as DraftPayload | null,
  version: null as string | null,
}

describe("shouldAdoptDraft", () => {
  test("adopts a foreign draft for this story", () => {
    expect(shouldAdoptDraft(event(), ctx)).toBe(true)
  })

  test("ignores another story's draft", () => {
    expect(shouldAdoptDraft(event({ storyId: "s2" }), ctx)).toBe(false)
  })

  test("ignores its own echo", () => {
    expect(shouldAdoptDraft(event({ origin: "this-device" }), ctx)).toBe(false)
  })

  test("a local write in flight outranks the wire", () => {
    // The event may even be newer — but our save has not resolved, and taking
    // the event would roll the composer backwards under the writer's hands.
    expect(
      shouldAdoptDraft(event(), {
        ...ctx,
        pending: { text: "half a sentence", mode: "say" },
      })
    ).toBe(false)
  })

  test("an empty pending text still counts as a write in flight", () => {
    // Clearing the composer (a sent move) is a write like any other; a foreign
    // draft must not repopulate the textarea while the clear is travelling.
    // The same holds for a bare mode swap — the payload is the write, whatever
    // half of it changed.
    expect(
      shouldAdoptDraft(event(), { ...ctx, pending: { text: "", mode: "do" } })
    ).toBe(false)
  })

  test("turns away an event no newer than what is on display", () => {
    const displayed = { ...ctx, version: "2026-08-28T12:00:10.000Z" }
    expect(shouldAdoptDraft(event(), displayed)).toBe(false)
    expect(
      shouldAdoptDraft(
        event({ version: "2026-08-28T12:00:09.000Z" }),
        displayed
      )
    ).toBe(false)
  })

  test("takes a strictly newer event", () => {
    expect(
      shouldAdoptDraft(event({ version: "2026-08-28T12:00:11.000Z" }), {
        ...ctx,
        version: "2026-08-28T12:00:10.000Z",
      })
    ).toBe(true)
  })

  test("with no version yet, any foreign event is news", () => {
    // A composer seeded with no draft row has nothing to compare against; the
    // first event to arrive is by definition the newest thing it knows.
    expect(shouldAdoptDraft(event(), { ...ctx, version: null })).toBe(true)
  })

  test("adopts a clear — empty text is the draft being sent elsewhere", () => {
    expect(
      shouldAdoptDraft(event({ text: "" }), {
        ...ctx,
        version: "2026-08-28T12:00:00.000Z",
      })
    ).toBe(true)
  })

  test("adopts a bare mode swap — same text, newer version", () => {
    // Tab pressed on the other device: the words did not move, the meaning of
    // the next keystroke did. The payload as a whole is what versions.
    expect(
      shouldAdoptDraft(
        event({ mode: "say", version: "2026-08-28T12:00:11.000Z" }),
        { ...ctx, version: "2026-08-28T12:00:10.000Z" }
      )
    ).toBe(true)
  })
})
