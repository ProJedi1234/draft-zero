// tests/server-synced.test.ts — The specification for `adopt`, the rule that
// decides whether a value arriving from the server is allowed to move a control
// the writer may be holding.
//
// This is the whole of magic sync for the inspector: a `change` event lands,
// the tree refetches, and every setting control is handed a fresh server value
// with no way of knowing whether it is news from another device or the echo of
// a save this device made two hundred milliseconds ago. Get it wrong in one
// direction and a model picked on the phone never appears on the desktop; get
// it wrong in the other and a slider snaps backwards under the writer's finger
// mid-drag, or a picker reverts to the value it held before the save it just
// made. Both failures are silent, and neither shows up in a single-device
// session — which is exactly why the rule is a pure function with a table.

import { describe, expect, test } from "bun:test"

import { adopt, type SyncState } from "@/hooks/use-server-synced"

/** Idle: nothing in flight, display and row agree. */
function settled<T>(value: T): SyncState<T> {
  return { value, server: value, pending: null }
}

/** Mid-save: `value` was written locally and its echo has not come back yet. */
function saving<T>(value: T): SyncState<T> {
  return { value, server: value, pending: { value } }
}

describe("adopt — a foreign write with nothing in flight", () => {
  test("moves the control", () => {
    expect(adopt(settled("gpt-4"), "claude-opus-5", false)).toEqual(
      settled("claude-opus-5")
    )
  })

  test("returns the same object when nothing moved, so React can bail out", () => {
    const state = settled("gpt-4")
    expect(adopt(state, "gpt-4", false)).toBe(state)
  })

  test("treats null as a value, not as absence (providerTag null means Auto)", () => {
    expect(adopt(settled<string | null>("cerebras"), null, false)).toEqual(
      settled<string | null>(null)
    )
    const auto = settled<string | null>(null)
    expect(adopt(auto, null, false)).toBe(auto)
  })
})

describe("adopt — while this device's own write is travelling", () => {
  // The props arriving during a save are frequently older than the save: the
  // revalidation that produced them may have been queued before our row hit the
  // database. Adopting one would roll the control backwards, and the writer
  // would watch their own change undo itself.
  test("ignores a prop that predates our write", () => {
    const state = saving("claude-opus-5")
    expect(adopt(state, "gpt-4", false)).toBe(state)
  })

  test("clears the pending write once the server hands our value back", () => {
    expect(adopt(saving("claude-opus-5"), "claude-opus-5", false)).toEqual(
      settled("claude-opus-5")
    )
  })

  // Losing this would strand the control: pending never clears, and every
  // later foreign change is ignored for the life of the mount.
  test("a foreign value arriving after the echo is adopted normally", () => {
    const afterEcho = adopt(saving("claude-opus-5"), "claude-opus-5", false)
    expect(adopt(afterEcho, "gpt-4", false)).toEqual(settled("gpt-4"))
  })
})

describe("adopt — hold (a slider mid-drag)", () => {
  test("leaves the thumb where the finger put it", () => {
    expect(
      adopt({ value: 0.7, server: 0.5, pending: null }, 1.2, true)
    ).toEqual({ value: 0.7, server: 1.2, pending: null })
  })

  // The point of tracking `server` through a held gesture. Without it the row
  // would still read 0.5, a release at 0.5 would look like "no change", the
  // save would be skipped — and the foreign 1.2 would be adopted on the next
  // render, silently discarding a deliberate drag back to 0.5.
  test("the row is tracked while held, so a release onto the old value still counts as a change", () => {
    const held = adopt({ value: 0.7, server: 0.5, pending: null }, 1.2, true)
    expect(held.server).toBe(1.2)
    expect(0.5 === held.server).toBe(false)
  })

  test("the held value lands the moment the gesture ends", () => {
    const held = adopt({ value: 0.7, server: 0.5, pending: null }, 1.2, true)
    expect(adopt(held, 1.2, false)).toEqual(settled(1.2))
  })

  // A release writes before it clears `hold`, so the write is already pending
  // by the time the un-hold reconciliation runs. The writer's release wins over
  // the foreign value on the grounds that it happened later.
  test("a write during the release beats the value that arrived mid-drag", () => {
    const releasedAt = saving(0.9)
    expect(adopt(releasedAt, 1.2, false)).toBe(releasedAt)
  })
})
