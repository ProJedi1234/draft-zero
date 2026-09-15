// lib/net/banner.ts — When the offline banner is shown, and in which form.
//
// A pure function so tests/net-banner.test.ts can be its specification, the
// way tests/composer-draft.test.ts is for lib/sync/draft.ts. These rules are
// the feature's whole contract with the reader and two of them are easy to
// break by accident, so they are pinned here rather than living inside an
// effect:
//
//   Collapsing is not dismissing. While offline, every path out of a banner
//   lands on `held`, never on `none` — `held` is the state where the chip is
//   the only thing left, and the chip is what makes folding the banner away
//   honest.
//   Nothing re-expands on a clock. The only inputs that produce a banner are
//   going offline, coming back, and losing a write. A timer can only ever
//   take the banner DOWN.

/**
 * `dropped` and `restored` are transitions and expire on their own. `failed`
 * is a transition that does not, because work disappearing should not be
 * allowed to scroll past. `held` is the resting offline state and shows no
 * banner at all.
 */
export type BannerPhase = "none" | "dropped" | "held" | "failed" | "restored"

export type BannerEvent =
  | { type: "went-offline" }
  | { type: "came-online" }
  | { type: "write-failed" }
  /** The auto-collapse delay elapsed. Only ever takes a banner down. */
  | { type: "timer-elapsed" }
  /** The ✕. Folds into the chip while offline; clears entirely when not. */
  | { type: "user-collapsed" }
  /** The reader moved on, so the announcement has already done its job. */
  | { type: "scrolled" }

export function nextBannerPhase(
  phase: BannerPhase,
  event: BannerEvent,
  offline: boolean
): BannerPhase {
  switch (event.type) {
    case "went-offline":
      return "dropped"

    case "came-online":
      return "restored"

    // Phase-independent on purpose. A write can be rolled back while online
    // too — a 500, a validation failure — and that is worth the same row.
    case "write-failed":
      return "failed"

    case "timer-elapsed":
      if (phase === "dropped") return "held"
      // `offline` rather than a flat "none": a restored banner can still be on
      // screen when the network drops again, and letting its timer clear the
      // phase outright would leave the app offline with nothing saying so.
      if (phase === "restored") return offline ? "held" : "none"
      // `failed` deliberately has no timer, and `held`/`none` are already down.
      return phase

    case "scrolled":
      return phase === "dropped" ? "held" : phase

    // The rule that makes the ✕ safe. Offline there is no way to reach `none`
    // from here, so the chip always survives.
    case "user-collapsed":
      return offline ? "held" : "none"
  }
}

/** Whether this phase paints a banner row at all. */
export function bannerIsVisible(phase: BannerPhase): boolean {
  return phase !== "none" && phase !== "held"
}

/** Whether this phase takes a timer, and how long it runs. */
export function bannerTimeoutMs(phase: BannerPhase): number | null {
  if (phase === "dropped") return AUTO_COLLAPSE_MS
  if (phase === "restored") return RESTORED_MS
  return null
}

/** Long enough to read two short lines, short enough not to become furniture. */
const AUTO_COLLAPSE_MS = 6_000

/** The green receipt. Carries less, so it goes sooner. */
const RESTORED_MS = 4_000
