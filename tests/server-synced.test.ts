// tests/server-synced.test.ts — The specification for `adopt`, the rule that
// decides whether a value arriving from the server is allowed to move a control
// the writer may be holding.
//
// `adopt` is the heart of magic sync, though not the whole of it — the hook
// around it also decides when to *ask* (see `isNews`), and a control that never
// asks is as stranded as one that answers wrongly. What lives here is the
// arbitration: a `change` event lands, the tree refetches, and every setting
// control is handed a fresh server value with no way of knowing, from the value
// alone, whether it is news from another device or a render that was already in
// flight when this device moved the row. Get it wrong in one direction and a
// model picked on the phone never appears on the desktop; get it wrong in the
// other and a slider snaps backwards under the writer's finger mid-drag, or a
// picker drops back to the previous model for the length of a revalidation.
//
// Both failures are silent, and one of them does not show up in a single-device
// session at all — which is exactly why the rule is a pure function with a
// table. The tables below are written in row versions, because that is the only
// thing that makes "older" decidable: `updated_at`, ISO-8601 UTC, string order
// equalling chronological order.

import { describe, expect, test } from "bun:test"

import {
  adopt,
  isNews,
  resetValue,
  settleValue,
  writeValue,
  type SyncState,
} from "@/hooks/use-server-synced"

const V1 = "2026-08-17T15:00:00.000Z"
const V2 = "2026-08-17T15:00:01.000Z"
const V3 = "2026-08-17T15:00:02.000Z"

/** Idle: nothing in flight, display and row agree, taken at version `v`. */
function settled<T>(value: T, v: string | null = V1): SyncState<T> {
  return { value, server: value, inFlight: 0, version: v }
}

/** Mid-save: `value` was written locally and the save has not come back yet. */
function saving<T>(value: T, v: string | null = V1): SyncState<T> {
  return { value, server: value, inFlight: 1, version: v }
}

describe("adopt — a foreign write with nothing in flight", () => {
  test("moves the control", () => {
    expect(adopt(settled("gpt-4"), "claude-opus-5", V2, false)).toEqual(
      settled("claude-opus-5", V2)
    )
  })

  test("returns the same object when nothing moved, so React can bail out", () => {
    const state = settled("gpt-4")
    expect(adopt(state, "gpt-4", V1, false)).toBe(state)
  })

  test("treats null as a value, not as absence (providerTag null means Auto)", () => {
    expect(adopt(settled<string | null>("cerebras"), null, V2, false)).toEqual(
      settled<string | null>(null, V2)
    )
  })
})

describe("adopt — a payload older than the one on display", () => {
  // The failure that cost a branch to find. A server action resolves before the
  // tree it revalidated has been applied, and a router refresh can be rendered
  // before a write and delivered after it. Such a payload says the previous
  // model in a voice indistinguishable from news, and taking it is what put the
  // picker back on the old name until the real payload landed.
  test("is ignored, whatever it says", () => {
    const state = settled("claude-opus-5", V2)
    expect(adopt(state, "gpt-4", V1, false)).toBe(state)
  })

  test("is ignored even when it repeats the version already taken", () => {
    const state = settled("claude-opus-5", V2)
    expect(adopt(state, "gpt-4", V2, false)).toBe(state)
  })

  test("a newer one is still adopted afterwards", () => {
    const state = settled("claude-opus-5", V2)
    expect(adopt(state, "gemini-3", V3, false)).toEqual(settled("gemini-3", V3))
  })
})

describe("adopt — while this device's own write is in flight", () => {
  test("nothing moves the control, however new the payload claims to be", () => {
    const state = saving("claude-opus-5")
    expect(adopt(state, "gpt-4", V3, false)).toBe(state)
  })

  // Two switches inside a second are two writes travelling at once. The first
  // one resolving must not hand the control back to props that predate the
  // second — which is what a single boolean would do.
  test("a count, not a flag: the first of two writes resolving keeps the hold", () => {
    let state = writeValue(settled("gpt-4"), "claude-opus-5")
    state = writeValue(state, "gemini-3")
    expect(state.inFlight).toBe(2)

    state = settleValue(state) // the first save came back
    expect(adopt(state, "claude-opus-5", V2, false).value).toBe("gemini-3")

    state = settleValue(state) // and now the second
    expect(adopt(state, "gemini-3", V3, false)).toEqual(settled("gemini-3", V3))
  })

  test("the payload carrying our own write is adopted once it resolves", () => {
    const state = settleValue(writeValue(settled("gpt-4"), "claude-opus-5"))
    expect(adopt(state, "claude-opus-5", V2, false)).toEqual(
      settled("claude-opus-5", V2)
    )
  })

  // Ours committed, then another device's landed on top. Nothing about our own
  // save tells us that — only the version does.
  test("a later foreign write wins once our own has resolved", () => {
    const state = settleValue(writeValue(settled("gpt-4"), "claude-opus-5"))
    expect(adopt(state, "gemini-3", V3, false)).toEqual(settled("gemini-3", V3))
  })
})

describe("adopt — hold (a slider mid-drag)", () => {
  test("leaves the thumb where the finger put it", () => {
    const held = adopt(
      { value: 0.7, server: 0.5, inFlight: 0, version: V1 },
      1.2,
      V2,
      true
    )
    expect(held.value).toBe(0.7)
  })

  // The point of tracking `server` through a held gesture. Without it the row
  // would still read 0.5, a release at 0.5 would look like "no change", the
  // save would be skipped — and the foreign 1.2 would be adopted on the next
  // render, silently discarding a deliberate drag back to 0.5.
  test("the row is tracked while held, so a release onto the old value still counts as a change", () => {
    const held = adopt(
      { value: 0.7, server: 0.5, inFlight: 0, version: V1 },
      1.2,
      V2,
      true
    )
    expect(held.server).toBe(1.2)
  })

  // The version is deliberately not taken while held. Taking it would leave the
  // release with nothing left to adopt, and the value that arrived mid-drag
  // would be lost rather than deferred.
  test("the held value lands the moment the gesture ends", () => {
    const held = adopt(
      { value: 0.7, server: 0.5, inFlight: 0, version: V1 },
      1.2,
      V2,
      true
    )
    expect(adopt(held, 1.2, V2, false)).toEqual(settled(1.2, V2))
  })

  test("a write during the release beats the value that arrived mid-drag", () => {
    const releasedAt = saving(0.9)
    expect(adopt(releasedAt, 1.2, V2, false)).toBe(releasedAt)
  })
})

describe("writeValue — what counts as a write", () => {
  test("a real change is counted, so the server is held off until it resolves", () => {
    expect(writeValue(settled("gpt-4"), "claude-opus-5")).toEqual({
      value: "claude-opus-5",
      server: "claude-opus-5",
      inFlight: 1,
      version: V1,
    })
  })

  // Callers commit unconditionally and decide afterwards whether anything
  // changed — a thumb released where it began, a picker reselecting the current
  // option. Counting that one would leave a write outstanding that no settle is
  // ever coming for, and the control would stop following the server for good.
  test("a write onto the value the row already holds is not counted", () => {
    expect(writeValue(settled("gpt-4"), "gpt-4").inFlight).toBe(0)
  })

  test("an unbalanced settle cannot drive the count negative", () => {
    expect(settleValue(settled("gpt-4")).inFlight).toBe(0)
  })
})

describe("a save that fails", () => {
  test("puts the control back and ends the write", () => {
    const state = resetValue(
      writeValue(settled("gpt-4"), "claude-opus-5"),
      "gpt-4"
    )
    expect(state).toEqual(settled("gpt-4"))
  })

  test("and the control follows the server again", () => {
    const state = resetValue(
      writeValue(settled("gpt-4"), "claude-opus-5"),
      "gpt-4"
    )
    expect(adopt(state, "gemini-3", V2, false)).toEqual(settled("gemini-3", V2))
  })
})

// ---------------------------------------------------------------------------
// The control around `adopt`
// ---------------------------------------------------------------------------

/**
 * `useServerSyncedValue`'s render loop without React: props in, one
 * reconciliation per change, and the same `seen`/`isNews` gate the hook uses to
 * decide whether to run `adopt` at all. That gate is where a control gets
 * stranded, and it is invisible to a test of `adopt` alone.
 */
class Control<T> {
  state: SyncState<T>
  private seen: {
    serverValue: T
    hold: boolean
    version: string | null
    inFlight: number
  }

  constructor(serverValue: T, version: string | null = V1) {
    this.state = {
      value: serverValue,
      server: serverValue,
      inFlight: 0,
      version,
    }
    this.seen = { serverValue, hold: false, version, inFlight: 0 }
  }

  /** A fresh prop from the server; mirrors the hook's render-phase adjustment. */
  render(serverValue: T, version: string | null = V1, hold = false): T {
    // Loops until the gate closes, exactly as React re-renders on setSeen. A
    // gate that never closes is an infinite render in the browser, so the cap
    // is a real assertion and not a guard rail.
    for (let pass = 0; ; pass++) {
      if (pass > 8) throw new Error("reconciliation did not settle")
      if (!isNews(this.seen, this.state, serverValue, version, hold)) break
      this.state = adopt(this.state, serverValue, version, hold)
      this.seen = { serverValue, hold, version, inFlight: this.state.inFlight }
    }
    return this.state.value
  }

  write(next: T) {
    this.state = writeValue(this.state, next)
  }

  settle() {
    this.state = settleValue(this.state)
  }

  reset(next: T) {
    this.state = resetValue(this.state, next)
  }
}

describe("switching the model, end to end", () => {
  // The bug, as the writer sees it: pick a model, watch it appear, watch it
  // revert to the previous one, watch it come back. Every render below is one
  // the browser actually performs.
  test("the picked model is shown once and never given back", () => {
    const control = new Control("gpt-4")
    control.render("gpt-4")

    control.write("claude-opus-5")
    // Closing the menu re-runs the reconciliation against props that have not
    // moved yet. This is where the previous fix armed itself by mistake.
    expect(control.render("gpt-4", V1, true)).toBe("claude-opus-5")
    expect(control.render("gpt-4", V1, false)).toBe("claude-opus-5")

    control.settle() // the action resolved; its payload is still in flight
    expect(control.render("gpt-4", V1)).toBe("claude-opus-5")

    // The revalidated payload lands, and changes nothing anyone can see.
    expect(control.render("claude-opus-5", V2)).toBe("claude-opus-5")
  })

  test("a refresh rendered before the write but delivered after it is ignored", () => {
    const control = new Control("gpt-4")
    control.render("gpt-4")

    control.write("claude-opus-5")
    control.settle()
    expect(control.render("claude-opus-5", V2)).toBe("claude-opus-5")

    // Now the straggler arrives: a tree rendered at V1, parsed late.
    expect(control.render("gpt-4", V1)).toBe("claude-opus-5")
  })
})

describe("a write that never gets its echo", () => {
  // The whole point of the mechanism is that a control follows the server. A
  // control that has quietly stopped is worse than one that never started:
  // nothing about it looks broken until two devices disagree for an hour.
  test("a failed save puts the control back in touch with the server", () => {
    const control = new Control("gpt-4")
    control.render("gpt-4")

    control.write("claude-opus-5")
    control.reset("gpt-4") // the save came back { ok: false }

    expect(control.render("gemini-3", V2)).toBe("gemini-3")
  })

  // Two devices, one row, same second: ours is not the write that lands last,
  // so our value is never echoed. Waiting for it would mean displaying a model
  // that is in no database anywhere until the story is reopened.
  test("a lost race adopts the value that actually won", () => {
    const control = new Control("gpt-4")
    control.render("gpt-4")

    control.write("claude-opus-5")
    // The other device's write settled the row, and its revalidation arrives
    // while ours is still travelling — correctly turned away.
    expect(control.render("gemini-3", V2)).toBe("claude-opus-5")

    control.settle()
    // Nothing re-offers V2. What ends the disagreement is our own write's
    // revalidation, which renders the row as it now stands: theirs.
    expect(control.render("gemini-3", V3)).toBe("gemini-3")
  })
})

describe("hold, from press to release", () => {
  test("a value arriving mid-gesture lands when the finger comes up", () => {
    const control = new Control(0.5)
    control.render(0.5)

    // Pressed, not yet moved — Base UI reports no value change for this, which
    // is why `hold` comes from the pointer and not from onValueChange.
    expect(control.render(1.2, V2, true)).toBe(0.5)
    expect(control.render(1.2, V2, false)).toBe(1.2)
  })

  test("a cancelled gesture is a release, not a permanent hold", () => {
    const control = new Control(0.5)
    control.render(0.5)
    control.render(0.5, V1, true)

    // The pointer is torn away by a scroll: no commit, no write — just the end
    // of the hold. The control has to start following the server again.
    expect(control.render(0.9, V2, false)).toBe(0.9)
  })
})

describe("a caller with no row version", () => {
  // The settings page's generation defaults live in a row with no updated_at.
  // Such a control cannot tell a stale payload from a fresh one, and falls back
  // to what this file did before: follow a change of the value itself.
  test("follows a changed value", () => {
    const control = new Control(0.5, null)
    control.render(0.5, null)
    expect(control.render(0.9, null)).toBe(0.9)
  })

  test("still refuses to move while its own write is in flight", () => {
    const control = new Control(0.5, null)
    control.render(0.5, null)

    control.write(0.9)
    expect(control.render(0.5, null)).toBe(0.9)

    control.settle()
    expect(control.render(0.9, null)).toBe(0.9)
  })
})
