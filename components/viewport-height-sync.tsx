"use client"

import * as React from "react"

/**
 * iOS Safari never resizes the layout viewport for the software keyboard — it
 * pans it instead, dragging the whole app shell around and hiding the header.
 * While the keyboard is up this publishes the visual viewport height as
 * `--app-h` (consumed by the `h-app` utility) so the shell shrinks to the space
 * that is actually visible and the composer lands on top of the keyboard, then
 * undoes Safari's pan. With no keyboard the property is removed and pure CSS
 * (100dvh) rules, so browser-chrome collapse never involves JS.
 *
 * "Keyboard up" requires an editable element to hold focus, not just an
 * innerHeight/visualViewport height mismatch. iOS updates the two viewports at
 * different times — during standalone launch and while the keyboard-dismiss
 * animation runs they transiently disagree with no keyboard on screen — and a
 * height-only heuristic pinned --app-h to a stale short value until the next
 * resize event, leaving a dead strip along the bottom edge.
 */

const isEditable = (el: Element | null): boolean =>
  el instanceof HTMLElement &&
  (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable)

export function ViewportHeightSync() {
  React.useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const root = document.documentElement
    let settle: number | undefined

    const sync = () => {
      // Pinch-zoom also shrinks the visual viewport — leave it alone.
      if (viewport.scale > 1) return

      const keyboardUp =
        isEditable(document.activeElement) &&
        window.innerHeight - viewport.height > 1
      if (keyboardUp) {
        root.style.setProperty("--app-h", `${viewport.height}px`)
        window.scrollTo(0, 0)
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
    window.addEventListener("resize", onChange)
    window.addEventListener("focusin", onChange)
    window.addEventListener("focusout", onChange)
    return () => {
      viewport.removeEventListener("resize", onChange)
      window.removeEventListener("resize", onChange)
      window.removeEventListener("focusin", onChange)
      window.removeEventListener("focusout", onChange)
      if (settle !== undefined) window.clearTimeout(settle)
      root.style.removeProperty("--app-h")
    }
  }, [])

  return null
}
