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
 */
export function ViewportHeightSync() {
  React.useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const root = document.documentElement

    const sync = () => {
      // Pinch-zoom also shrinks the visual viewport — leave it alone.
      if (viewport.scale > 1) return

      const keyboardUp = window.innerHeight - viewport.height > 1
      if (keyboardUp) {
        root.style.setProperty("--app-h", `${viewport.height}px`)
        window.scrollTo(0, 0)
      } else {
        root.style.removeProperty("--app-h")
      }
    }

    sync()
    viewport.addEventListener("resize", sync)
    return () => {
      viewport.removeEventListener("resize", sync)
      root.style.removeProperty("--app-h")
    }
  }, [])

  return null
}
