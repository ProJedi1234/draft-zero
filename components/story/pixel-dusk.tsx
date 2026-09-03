"use client"

import * as React from "react"

import { createDuskScene, type DuskScene } from "@/lib/pixel-dusk"
import { cn } from "@/lib/utils"

/** The skeleton renders on the server, where a layout effect only warns. */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false)
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = (): void => setReduced(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])
  return reduced
}

/**
 * The loading landscape as a component: a canvas the engine paints, sized by
 * whatever box this is put in. `hue: null` renders the greyscale scene, the
 * same rule the tint palette follows at strength 0.
 *
 * `dissolving` is one-way: mounted with it (or flipped to it), the scene
 * clears itself cell by cell and reports back once — the caller unmounts it.
 */
export function PixelDusk({
  hue,
  strength,
  day,
  dissolving = false,
  onDissolved,
  className,
}: {
  hue: number | null
  strength: number
  day: boolean
  dissolving?: boolean
  onDissolved?: () => void
  className?: string
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const sceneRef = React.useRef<DuskScene | null>(null)
  const reduced = useReducedMotion()

  const onDissolvedRef = React.useRef(onDissolved)
  React.useEffect(() => {
    onDissolvedRef.current = onDissolved
  })

  // Measuring the box and painting the first frame both have to finish before
  // the browser paints. A passive effect can leave one frame of transparent
  // canvas, which is nothing over the skeleton but a blink over the mounted
  // workspace the dissolve overlay covers — and the hold makes that blink long
  // enough to see. The two below run in declaration order, so the seed config
  // is corrected to the live props before anything reaches the screen.
  useIsomorphicLayoutEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    // Config here is only the seed; the effect below re-applies the live
    // props right after (mount, and again if `reduced` recreates the scene).
    const scene = createDuskScene(
      canvas,
      { hue: 0, strength: 0, day: false },
      { animate: !reduced }
    )
    sceneRef.current = scene
    const observer = new ResizeObserver(() => scene.resize())
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      scene.destroy()
      sceneRef.current = null
    }
  }, [reduced])

  useIsomorphicLayoutEffect(() => {
    sceneRef.current?.set({
      hue: hue ?? 0,
      strength: hue === null ? 0 : strength,
      day,
    })
  }, [hue, strength, day, reduced])

  React.useEffect(() => {
    if (!dissolving) return
    sceneRef.current?.dissolve(() => onDissolvedRef.current?.())
  }, [dissolving])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("size-full [image-rendering:pixelated]", className)}
    />
  )
}
