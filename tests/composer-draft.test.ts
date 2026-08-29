// tests/composer-draft.test.ts — the specification for shouldAdoptDraft: which
// incoming `draft` events a mounted composer writes into its textarea.

import { describe, expect, test } from "bun:test"

import {
  SERVER_DRAFT_ORIGIN,
  shouldAdoptDraft,
  type DraftPayload,
} from "@/lib/sync/draft"
import { syncClientId, type DraftEvent } from "@/lib/sync/client"

const event = (overrides: Partial<DraftEvent> = {}): DraftEvent => ({
  type: "draft",
  storyId: "s1",
  text: "the door creaks open",
  mode: "do",
  imagePrompt: null,
  imageAssisted: true,
  imageStyle: null,
  version: "2026-08-28T12:00:10.000Z",
  origin: "other-device",
  ...overrides,
})

/** A whole payload from the one or two fields a case is actually about. */
const payload = (overrides: Partial<DraftPayload> = {}): DraftPayload => ({
  text: "the door creaks open",
  mode: "do",
  imagePrompt: null,
  imageAssisted: true,
  imageStyle: null,
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
        pending: payload({ text: "half a sentence", mode: "say" }),
      })
    ).toBe(false)
  })

  test("an empty pending text still counts as a write in flight", () => {
    // Clearing the composer (a sent move) is a write like any other; a foreign
    // draft must not repopulate the textarea while the clear is travelling.
    // The same holds for a bare mode swap — the payload is the write, whatever
    // half of it changed.
    expect(
      shouldAdoptDraft(event(), { ...ctx, pending: payload({ text: "" }) })
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

  test("adopts the develop run's own settle, on the device that launched it", () => {
    // A finished derivation writes the lane itself, from inside its detached
    // run, and stamps SERVER_DRAFT_ORIGIN. The launching device has to take it
    // like anybody else's: what its composer is showing is streamed display
    // text that was never published, and this event is the moment it becomes
    // the draft. Nothing about a server origin may read as this device's echo.
    expect(
      shouldAdoptDraft(
        event({
          origin: SERVER_DRAFT_ORIGIN,
          imagePrompt: "a tomb door, torch raised, wet stone",
          mode: "image",
          version: "2026-08-28T12:00:11.000Z",
        }),
        { ...ctx, version: "2026-08-28T12:00:10.000Z" }
      )
    ).toBe(true)
  })

  test("no device id can collide with the server's draft origin", () => {
    // syncClientId is base36 with no separator, which is what makes the rule
    // above structural rather than lucky.
    expect(SERVER_DRAFT_ORIGIN).toMatch(/:/)
    expect(syncClientId).not.toContain(":")
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
