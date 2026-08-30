"use client"

import * as React from "react"

/**
 * Puts the current story's tint on :root, as a stylesheet.
 *
 * A stylesheet rather than an inline style on the workspace, because the two
 * variables have to reach the whole document: the rail sits outside this
 * subtree, and a sidebar that stayed neutral while the manuscript beside it
 * warmed would read as a rendering bug rather than a choice. Unmounting on
 * navigation is what returns the library and settings to the neutral palette,
 * with no cleanup to forget.
 *
 * Rendered on the server, so the tint is in the first paint. The alternative —
 * writing the variables from an effect — is a visible flash of the untinted
 * app on every load, which is the failure next-themes carries a blocking
 * inline script to avoid.
 *
 * The values are interpolated into CSS the browser will execute, so they are
 * re-clamped here even though the action that stored them clamped too: this is
 * the last point before they stop being data, and a NaN reaching the sheet
 * would break every token that reads them rather than just this one.
 */
export const TINT_CHANGE_EVENT = "draft-zero:tint"

/**
 * How a hue-to-hue change moves. The post-turn atmosphere call is the case
 * this exists for: it swaps hue while leaving strength alone, so before this
 * nothing was transitioned at all and the whole palette changed in one frame.
 *
 * The room turns over TURN_MS while dipping to DIP of its strength at the
 * halfway point, and the two together are what make it read as a change of
 * light rather than a change of stylesheet. The turn alone still sweeps every
 * hue in between at full saturation, which is the rainbow wipe the old
 * hue-snaps rule was avoiding; the dip pales those intermediates out so the
 * eye reads a colour draining and refilling, and only notices afterwards that
 * it refilled somewhere else.
 */
const TURN_MS = 900
const DIP = 0.55

/** How --story-c moves when only the strength changed — a slider drag. */
const FADE_MS = 500

// Eased at both ends, so the dip leaves and rejoins full strength without a
// corner — the turn is two transitions sharing one clock.
const EASE = "cubic-bezier(0.4, 0, 0.2, 1)"

type Sheet = {
  /**
   * The hue as written to CSS, which is NOT clamped to 0–360. CSS interpolates
   * a <number> along the line between two values, so a stored 305 following a
   * stored 25 has to be written as -55 to travel the 80° between them instead
   * of the 280° the other way round. oklch() takes the hue modulo 360, so an
   * unwrapped value renders identically to its clamped twin — and unwrapping
   * is never undone, because "normalizing" -55 back to 305 afterwards is
   * itself a value change, and would sweep the long way as its own transition.
   */
  h: number
  c: number
  /** Milliseconds for each of the two transitions; 0 means snap. */
  cMs: number
  hMs: number
}

function shortestTurn(from: number, to: number) {
  // Both reduced to the same revolution first, so the delta is a turn within
  // one wheel however far `from` has drifted from unwrapping.
  const delta = ((((to - from) % 360) + 540) % 360) - 180
  return from + delta
}

export function StoryTint({
  hue,
  strength,
}: {
  hue: number | null
  strength: number
}) {
  const tinted = hue !== null && Number.isFinite(hue)
  const h = tinted ? ((Math.round(hue) % 360) + 360) % 360 : 0
  const c =
    tinted && Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0

  // Seeded from the props so the first client render matches the server's, and
  // so a story opened cold arrives already wearing its colour rather than
  // fading into it — the transition is for a tint that CHANGES under the
  // reader, not for one that was there before they got here.
  const [sheet, setSheet] = React.useState<Sheet>({
    h,
    c,
    cMs: FADE_MS,
    hMs: 0,
  })
  // The sheet as last written, read by the effect below to know where the
  // colour is travelling FROM. A ref rather than the state it mirrors, because
  // that effect must not re-run when it lands its own trough — only a genuine
  // change of hue or strength starts a transition.
  const applied = React.useRef(sheet)
  const write = React.useCallback((next: Sheet) => {
    applied.current = next
    setSheet(next)
  }, [])

  React.useEffect(() => {
    const prev = applied.current
    const prevHue = ((prev.h % 360) + 360) % 360
    if (prev.c === c && (prevHue === h || c === 0)) return

    // A hue change is only visible where there is chroma at both ends. Going
    // to or from untinted is a fade, and gets the departing hue held in place
    // for the duration: the value is meaningless at strength 0, so snapping it
    // would tint the last frames of the fade-out some unrelated colour.
    const turning = c > 0 && prev.c > 0 && prevHue !== h
    if (!turning) {
      write({ h: c > 0 ? h : prev.h, c, cMs: FADE_MS, hMs: 0 })
      return
    }

    const next = shortestTurn(prev.h, h)
    write({ h: next, c: c * DIP, cMs: TURN_MS / 2, hMs: TURN_MS })
    // Only --story-c is restated at the trough. --story-h keeps both the value
    // and the duration it already has, so its transition is untouched and runs
    // the full turn across the two phases rather than restarting halfway.
    const refill = window.setTimeout(() => {
      write({ h: next, c, cMs: TURN_MS / 2, hMs: TURN_MS })
    }, TURN_MS / 2)
    return () => window.clearTimeout(refill)
  }, [h, c, write])

  // StatusBarTint samples a computed background and cannot see any of this: it
  // watches the class attribute on <html>, which a stylesheet swap never
  // touches. Sampled again once the colour has settled, because a sample taken
  // while the page is mid-turn catches a colour it is only travelling through.
  React.useEffect(() => {
    const notify = () => window.dispatchEvent(new Event(TINT_CHANGE_EVENT))
    notify()
    const settled = window.setTimeout(notify, TURN_MS + 50)
    return () => window.clearTimeout(settled)
  }, [sheet])

  // Leaving a story is a tint change too. The stylesheet goes with this
  // component, returning :root to the neutral palette — and StatusBarTint can
  // no more see that than it could see the arrival, so the strip would keep the
  // departed story's colour over a neutral library until some unrelated class
  // change revived it. Its own effect does not re-run on navigation: it depends
  // on the sidebar's open state, nothing else.
  React.useEffect(() => {
    return () => {
      const notify = () => window.dispatchEvent(new Event(TINT_CHANGE_EVENT))
      notify()
      window.setTimeout(notify, TURN_MS + 50)
    }
  }, [])

  return (
    <style>{`:root{--story-h:${sheet.h};--story-c:${sheet.c};transition:--story-c ${sheet.cMs}ms ${EASE},--story-h ${sheet.hMs}ms ${EASE}}`}</style>
  )
}
