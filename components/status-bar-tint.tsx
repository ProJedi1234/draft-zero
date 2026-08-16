"use client"

import * as React from "react"

import { useSidebar } from "@/components/ui/sidebar"

/**
 * Keeps iOS's status bar the same colour as whatever is directly beneath it.
 *
 * #25 chased this with `black-translucent`, which paints the web view under the
 * clock. That turned out to be the source of the stranded bottom edge: iOS gave
 * the web view the full screen but a layout viewport still sized to
 * screen-minus-status-bar, so the shell was permanently one status-bar-height
 * out of register. Under the plain `default` style the strip sits above the web
 * view instead — no bleed, but also no viewport mismatch — and its colour comes
 * from the theme-color meta, which is free to change at runtime.
 *
 * That covers the case #25 actually cared about. On a phone the sidebar is a
 * Sheet rather than a persistent pane, so the strip only ever spans one surface
 * at a time: --background normally, --sidebar while the sheet is open.
 *
 * The colour is read from the DOM rather than duplicated here, so it keeps
 * tracking globals.css and the active theme.
 */
export function StatusBarTint() {
  const { openMobile } = useSidebar()

  React.useEffect(() => {
    const apply = () => {
      const probe = document.createElement("div")
      probe.className = openMobile ? "bg-sidebar" : "bg-background"
      probe.style.cssText =
        "position:fixed;visibility:hidden;pointer-events:none"
      document.body.appendChild(probe)
      const computed = getComputedStyle(probe).backgroundColor
      probe.remove()
      if (!computed) return

      // Round-trip through a canvas rather than using the computed string
      // directly: these are oklch() in globals.css, and engines serialize them
      // as oklab()/color() — which theme-color parsers reject, leaving the
      // strip on its stale value. Painting and reading pixels yields plain sRGB
      // bytes that every parser accepts.
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext("2d", { willReadFrequently: true })
      if (!ctx) return
      ctx.fillStyle = computed
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
      const color = `rgb(${r}, ${g}, ${b})`

      // A media-less theme-color outranks Next's two media-scoped tags: the
      // spec takes the first one whose media matches, and this one always
      // matches.
      //
      // Content is set before the tag is ever attached. WebKit appears to read
      // a theme-color element once, as it is inserted — attach first and write
      // after and it latches the empty value, ignoring the tag until some later
      // mutation of an already-present element revives it. That produced a
      // first-run-only failure: the tint stayed dead until an unrelated dialog
      // tripped the observer below, and worked from then on.
      const existing = document.head.querySelector<HTMLMetaElement>(
        'meta[name="theme-color"][data-runtime]'
      )
      if (existing) {
        existing.content = color
        return
      }
      const meta = document.createElement("meta")
      meta.name = "theme-color"
      meta.dataset.runtime = ""
      meta.content = color
      document.head.prepend(meta)
    }

    apply()
    // next-themes swaps the class on <html>, which changes what --background
    // and --sidebar resolve to without changing openMobile.
    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, {
      attributes: true,
      // class only: ViewportHeightSync writes --app-h to the same element's
      // style on every touch, and repainting the strip for that is pure waste.
      attributeFilter: ["class"],
    })
    return () => observer.disconnect()
  }, [openMobile])

  return null
}
