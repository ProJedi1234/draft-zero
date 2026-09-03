"use client"

import * as React from "react"

/**
 * iOS Safari never resizes the layout viewport for the software keyboard — it
 * pans it instead, dragging the whole app shell around and hiding the header.
 * While the keyboard is up this publishes the visual viewport height as
 * `--app-h` (consumed by the `h-app` utility) so the shell shrinks to the space
 * that is actually visible and the composer lands on top of the keyboard, then
 * undoes Safari's pan.
 *
 * Installed standalone the shell is measured rather than inferred: `--app-h` is
 * published as `innerHeight`, the layout viewport. `100dvh` and `min-h-svh` both
 * resolve against the screen, and the two are not the same box — a shell sized
 * to the screen inside a shorter layout viewport is taller than the document
 * that contains it, and that overflow is what let the whole shell scroll up and
 * strand its bottom edge. In a browser tab `--app-h` stays unset and CSS
 * `100dvh` rules, keeping chrome-collapse a pure-CSS concern.
 */

// A real keyboard takes hundreds of px. Fractions of the window were too
// forgiving: 15% of an 852pt iPhone is ~128px, which let a stale remainder
// through and pinned the shell to it.
const KEYBOARD_MIN_PX = 150

const isEditable = (el: Element | null): boolean =>
  el instanceof HTMLElement &&
  (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable)

const isStandalone = (): boolean =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

export function ViewportHeightSync() {
  React.useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const root = document.documentElement
    let settle: number | undefined

    const sync = () => {
      const layout = window.innerHeight

      // Pinch-zoom shrinks the visual viewport without a keyboard. This only
      // disqualifies the keyboard test rather than returning early, which used
      // to strand whatever --app-h was last pinned with no path to clear it.
      const keyboardUp =
        viewport.scale <= 1 &&
        isEditable(document.activeElement) &&
        layout - viewport.height > KEYBOARD_MIN_PX

      if (keyboardUp) {
        root.style.setProperty("--app-h", `${viewport.height}px`)
        window.scrollTo(0, 0)
      } else if (isStandalone()) {
        // Nothing while pinch-zoomed: iOS reports innerHeight against the
        // VISUAL viewport, so republishing would divide the shell by the
        // reader's own scale, and the un-pan would fight their pan. Zoom is
        // transient — hold the last good measurement until they come back.
        if (viewport.scale <= 1) {
          root.style.setProperty("--app-h", `${layout}px`)
          if (window.scrollY !== 0) window.scrollTo(0, 0)
        }
      } else {
        root.style.removeProperty("--app-h")
      }
    }

    // The two heights settle on different schedules and iOS does not always
    // fire a final event once they converge, so every trigger also schedules
    // one trailing re-check after the geometry has had time to come to rest.
    const onChange = () => {
      sync()
      if (settle !== undefined) window.clearTimeout(settle)
      settle = window.setTimeout(sync, 250)
    }

    onChange()
    viewport.addEventListener("resize", onChange)
    viewport.addEventListener("scroll", onChange)
    window.addEventListener("resize", onChange)
    window.addEventListener("orientationchange", onChange)
    window.addEventListener("focusin", onChange)
    window.addEventListener("focusout", onChange)
    window.addEventListener("touchend", onChange, { passive: true })
    // An installed PWA is suspended and restored, not reloaded: the inline
    // --app-h and the stale geometry both survive, and iOS only sometimes fires
    // a resize on the way back. Without these the app inherits the previous
    // session's measurement, which is what made the bug look random from launch
    // to launch.
    window.addEventListener("pageshow", onChange)
    document.addEventListener("visibilitychange", onChange)

    return () => {
      viewport.removeEventListener("resize", onChange)
      viewport.removeEventListener("scroll", onChange)
      window.removeEventListener("resize", onChange)
      window.removeEventListener("orientationchange", onChange)
      window.removeEventListener("focusin", onChange)
      window.removeEventListener("focusout", onChange)
      window.removeEventListener("touchend", onChange)
      window.removeEventListener("pageshow", onChange)
      document.removeEventListener("visibilitychange", onChange)
      if (settle !== undefined) window.clearTimeout(settle)
      root.style.removeProperty("--app-h")
    }
  }, [])

  return null
}
