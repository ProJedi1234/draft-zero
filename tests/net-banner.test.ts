// tests/net-banner.test.ts — the specification for lib/net/banner.ts.
//
// The two invariants at the bottom are the ones worth breaking the build over:
// offline, the banner can always be folded away and can never be dismissed
// into nothing; and no timer can ever bring one back.

import { describe, expect, test } from "bun:test"

import {
  bannerIsVisible,
  bannerTimeoutMs,
  nextBannerPhase,
  type BannerEvent,
  type BannerPhase,
} from "@/lib/net/banner"

const ALL_PHASES: BannerPhase[] = [
  "none",
  "dropped",
  "held",
  "failed",
  "restored",
]

const ALL_EVENTS: BannerEvent[] = [
  { type: "went-offline" },
  { type: "came-online" },
  { type: "write-failed" },
  { type: "timer-elapsed" },
  { type: "user-collapsed" },
  { type: "scrolled" },
]

describe("transitions", () => {
  test("losing the network always announces, from any phase but failed", () => {
    // failed is the one phase a connectivity event must not overwrite — see
    // "a connectivity flap cannot overwrite an unacknowledged failure" below.
    for (const phase of ALL_PHASES) {
      if (phase === "failed") continue
      expect(nextBannerPhase(phase, { type: "went-offline" }, true)).toBe(
        "dropped"
      )
    }
  })

  test("the drop folds into the chip on a timer", () => {
    expect(nextBannerPhase("dropped", { type: "timer-elapsed" }, true)).toBe(
      "held"
    )
  })

  test("a scroll folds it early — the reader has already moved on", () => {
    expect(nextBannerPhase("dropped", { type: "scrolled" }, true)).toBe("held")
  })

  test("a scroll does nothing to a banner that is not the drop", () => {
    expect(nextBannerPhase("failed", { type: "scrolled" }, true)).toBe("failed")
    expect(nextBannerPhase("restored", { type: "scrolled" }, false)).toBe(
      "restored"
    )
  })

  test("coming back announces, then clears completely", () => {
    const restored = nextBannerPhase("held", { type: "came-online" }, false)
    expect(restored).toBe("restored")
    expect(nextBannerPhase(restored, { type: "timer-elapsed" }, false)).toBe(
      "none"
    )
  })

  test("a rolled-back write has no timer, because it must not scroll past", () => {
    expect(bannerTimeoutMs("failed")).toBeNull()
    expect(nextBannerPhase("failed", { type: "timer-elapsed" }, true)).toBe(
      "failed"
    )
  })

  test("a connectivity flap cannot overwrite an unacknowledged failure", () => {
    // The bug this guards: went-offline/came-online used to return their
    // target phase unconditionally, so a network flap arriving while
    // `failed` was on screen silently replaced it — the same broken promise
    // as a timer clearing it, just via a different event.
    expect(nextBannerPhase("failed", { type: "went-offline" }, true)).toBe(
      "failed"
    )
    expect(nextBannerPhase("failed", { type: "came-online" }, false)).toBe(
      "failed"
    )
  })

  test("a fresh failure is still news, even mid-flap", () => {
    // write-failed stays phase-independent regardless of the fix above: a
    // NEW failure is always worth the row, it is only a stale one that must
    // not be silently swapped out from under the reader.
    expect(nextBannerPhase("dropped", { type: "write-failed" }, true)).toBe(
      "failed"
    )
    expect(nextBannerPhase("restored", { type: "write-failed" }, false)).toBe(
      "failed"
    )
  })

  test("a failed write announces whether or not we are offline", () => {
    expect(nextBannerPhase("none", { type: "write-failed" }, false)).toBe(
      "failed"
    )
    expect(nextBannerPhase("held", { type: "write-failed" }, true)).toBe(
      "failed"
    )
  })
})

describe("visibility", () => {
  test("held is the resting offline state and shows no row", () => {
    expect(bannerIsVisible("held")).toBe(false)
    expect(bannerIsVisible("none")).toBe(false)
    expect(bannerIsVisible("dropped")).toBe(true)
    expect(bannerIsVisible("failed")).toBe(true)
    expect(bannerIsVisible("restored")).toBe(true)
  })
})

describe("invariants", () => {
  test("offline, no event moves the phase INTO none", () => {
    // `none` while offline is the state the whole design forbids: the app is
    // offline and nothing on screen says so. Phrased as "cannot be entered"
    // rather than "cannot be observed", because `none` + offline is not a
    // state the provider can be in — going offline always produces `dropped`
    // — and an event that leaves an impossible input alone is not a fault.
    for (const phase of ALL_PHASES) {
      for (const event of ALL_EVENTS) {
        const next = nextBannerPhase(phase, event, true)
        if (next === "none") expect(phase).toBe("none")
      }
    }
  })

  test("the ✕ collapses while offline and only clears when online", () => {
    for (const phase of ALL_PHASES) {
      expect(nextBannerPhase(phase, { type: "user-collapsed" }, true)).toBe(
        "held"
      )
      expect(nextBannerPhase(phase, { type: "user-collapsed" }, false)).toBe(
        "none"
      )
    }
  })

  test("a timer can only ever take a banner down, never raise one", () => {
    for (const phase of ALL_PHASES) {
      const next = nextBannerPhase(phase, { type: "timer-elapsed" }, true)
      if (bannerIsVisible(phase)) continue
      expect(bannerIsVisible(next)).toBe(false)
    }
  })
})
