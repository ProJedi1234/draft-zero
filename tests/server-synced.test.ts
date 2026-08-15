// tests/server-synced.test.ts — The specification for `adopt`, the rule that
// decides whether a value arriving from the server is allowed to move a control
// the writer may be holding.
//
// `adopt` is the heart of magic sync, though not the whole of it — the hook
// around it also decides when to *ask*, and how a write in flight is released
// when no echo is coming (see `settle`/`reset` in hooks/use-server-synced.ts).
// What lives here is the arbitration: a `change` event lands,
// the tree refetches, and every setting control is handed a fresh server value
// with no way of knowing whether it is news from another device or the echo of
// a save this device made two hundred milliseconds ago. Get it wrong in one
// direction and a model picked on the phone never appears on the desktop; get
// it wrong in the other and a slider snaps backwards under the writer's finger
// mid-drag, or a picker reverts to the value it held before the save it just
// made. Both failures are silent, and neither shows up in a single-device
// session — which is exactly why the rule is a pure function with a table.

import { describe, expect, test } from "bun:test"

import {
  adopt,
  settleValue,
  writeValue,
  type SyncState,
} from "@/hooks/use-server-synced"

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

// ---------------------------------------------------------------------------
// The control around `adopt`
// ---------------------------------------------------------------------------

/**
 * `useServerSyncedValue`'s render loop without React: props in, one
 * reconciliation per change, and the same `seen`/epoch gate the hook uses to
 * decide whether to run `adopt` at all. That gate is where a control gets
 * stranded, and it is invisible to a test of `adopt` alone — every case below
 * passes `adopt` on its own and still leaves the writer looking at a value the
 * database does not hold.
 */
class Control<T> {
  state: SyncState<T>
  private seen: { serverValue: T; hold: boolean; epoch: number }
  private epoch = 0

  constructor(serverValue: T) {
    this.state = { value: serverValue, server: serverValue, pending: null }
    this.seen = { serverValue, hold: false, epoch: 0 }
  }

  /** A fresh prop from the server; mirrors the hook's render-phase adjustment. */
  render(serverValue: T, hold = false): T {
    if (
      !Object.is(this.seen.serverValue, serverValue) ||
      this.seen.hold !== hold ||
      this.seen.epoch !== this.epoch
    ) {
      this.state = adopt(this.state, serverValue, hold)
      this.seen = { serverValue, hold, epoch: this.epoch }
    }
    return this.state.value
  }

  write(next: T) {
    this.state = writeValue(this.state, next)
  }

  settle() {
    this.state = settleValue(this.state)
    this.epoch += 1
  }

  reset(next: T) {
    this.state = { value: next, server: next, pending: null }
    this.epoch += 1
  }
}

describe("a write that never gets its echo", () => {
  // The whole point of the mechanism is that a control follows the server. A
  // control that has quietly stopped is worse than one that never started:
  // nothing about it looks broken until two devices disagree for an hour.
  test("a failed save puts the control back in touch with the server", () => {
    const control = new Control("gpt-4")
    control.render("gpt-4")

    control.write("claude-opus-5")
    control.reset("gpt-4") // the save came back { ok: false }

    // A foreign change now lands, and must be adopted like any other.
    expect(control.render("gemini-3")).toBe("gemini-3")
  })

  // Two devices, one row, same second: ours is not the write that lands last,
  // so our value is never echoed. Waiting for it would mean displaying a model
  // that is in no database anywhere until the story is reopened.
  test("a lost race adopts the value that actually won", () => {
    const control = new Control("gpt-4")
    control.render("gpt-4")

    control.write("claude-opus-5")
    // The other device's write settled the row, and its revalidation arrives
    // first — correctly turned away while ours is still travelling.
    expect(control.render("gemini-3")).toBe("claude-opus-5")

    control.settle() // our save resolved ok; the row is whatever it now says
    expect(control.render("gemini-3")).toBe("gemini-3")
  })

  // The subtle one: the rejected prop advanced `seen`, so the props need never
  // change again — and if only `pending` were cleared, nothing would ever
  // re-offer the value the control is out of step with.
  test("re-adopts a value that was turned away, without it arriving twice", () => {
    const control = new Control<string | null>(null)
    control.render(null)

    control.write("cerebras")
    control.render("groq") // turned away, but seen
    control.reset(null) // and then the save failed

    // "groq" is not sent again — it is already the row, and the bus has no
    // reason to announce it a second time.
    expect(control.render("groq")).toBe("groq")
  })

  test("a successful save keeps the value it wrote when the echo agrees", () => {
    const control = new Control(0.5)
    control.render(0.5)

    control.write(0.9)
    control.settle()
    expect(control.render(0.9)).toBe(0.9)
  })
})

describe("hold, from press to release", () => {
  test("a value arriving mid-gesture lands when the finger comes up", () => {
    const control = new Control(0.5)
    control.render(0.5)

    // Pressed, not yet moved — Base UI reports no value change for this, which
    // is why `hold` comes from the pointer and not from onValueChange.
    expect(control.render(1.2, true)).toBe(0.5)
    expect(control.render(1.2, false)).toBe(1.2)
  })

  test("a cancelled gesture is a release, not a permanent hold", () => {
    const control = new Control(0.5)
    control.render(0.5)
    control.render(0.5, true)

    // The pointer is torn away by a scroll: no commit, no write — just the end
    // of the hold. The control has to start following the server again.
    expect(control.render(0.9, false)).toBe(0.9)
  })
})
