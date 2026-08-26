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

  // StatusBarTint samples a computed background and cannot see this: it watches
  // the class attribute on <html>, which a stylesheet swap never touches. Twice
  // on purpose — once now for the immediate move, once after the 500ms strength
  // transition in globals.css has landed, because the first sample catches a
  // colour the page is still travelling through.
  React.useEffect(() => {
    const notify = () => window.dispatchEvent(new Event(TINT_CHANGE_EVENT))
    notify()
    const settled = window.setTimeout(notify, 550)
    return () => window.clearTimeout(settled)
  }, [h, c])

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
      window.setTimeout(notify, 550)
    }
  }, [])

  return <style>{`:root{--story-h:${h};--story-c:${c}}`}</style>
}
