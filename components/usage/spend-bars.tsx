"use client"

import * as React from "react"

import { formatUsd } from "@/lib/format"
import type { SpendBar } from "@/lib/spend-window"
import { cn } from "@/lib/utils"

/** Geometry, in viewBox units: 2 wide, 2 apart, square. */
const BAR = 2
const GAP = 2
const PITCH = BAR + GAP
const HEIGHT = 40
/** A day with no spend still gets a mark, so the gap reads as "nothing" not "no data". */
const STUB = 1

/** "2026-08-11" -> "Tue 11 Aug", in UTC to match the buckets. */
function formatBarDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
}

/**
 * Daily spend as a bare strip of bars. No library, no axes, no gridlines, no
 * labels: the shape is the whole message, and the numbers arrive on hover.
 *
 * The bars stretch to the card's width (preserveAspectRatio="none") while the
 * vertical scale stays 1 unit = 1 pixel, so heights are honest even though the
 * duty cycle is not literally 2px/2px on a wide screen.
 */
export function SpendBars({
  bars,
  className,
}: {
  bars: SpendBar[]
  className?: string
}) {
  const [active, setActive] = React.useState<number | null>(null)
  const width = Math.max(bars.length * PITCH - GAP, 1)
  const peak = bars.reduce((max, bar) => Math.max(max, bar.value), 0)

  function handleMove(event: React.PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width === 0) return
    const ratio = (event.clientX - box.left) / box.width
    const index = Math.floor(ratio * bars.length)
    setActive(index < 0 || index >= bars.length ? null : index)
  }

  const hovered = active === null ? null : (bars[active] ?? null)

  return (
    <div className={cn("relative", className)}>
      {/* Readout sits above the strip and never displaces it: one positioned
          div for the whole chart, because intent is already declared by the
          time the pointer is inside it. */}
      <div className="pointer-events-none absolute inset-x-0 -top-1 h-6">
        {hovered ? (
          <div
            className="absolute -translate-x-1/2 bg-foreground px-2 py-1 font-mono text-[0.6875rem] whitespace-nowrap text-background tabular-nums"
            style={{
              left: `${(((active ?? 0) + 0.5) / bars.length) * 100}%`,
            }}
          >
            {formatBarDay(hovered.day)} · {formatUsd(hovered.costUsd)} ·{" "}
            {hovered.calls} {hovered.calls === 1 ? "generation" : "generations"}
          </div>
        ) : null}
      </div>

      <div
        className="text-foreground"
        onPointerMove={handleMove}
        onPointerLeave={() => setActive(null)}
      >
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="block h-10 w-full"
          role="img"
          aria-label={`Daily spend over the last ${bars.length} days`}
        >
          {bars.map((bar, index) => {
            // Peak-relative, not log: the question a writer asks of this strip
            // is "which day was the expensive one", and that is a ratio.
            const height =
              peak > 0 && bar.value > 0
                ? Math.max(STUB, (bar.value / peak) * HEIGHT)
                : STUB
            return (
              <rect
                key={bar.day}
                x={index * PITCH}
                y={HEIGHT - height}
                width={BAR}
                height={height}
                fill="currentColor"
                opacity={index === active ? 0.6 : 0.25}
              />
            )
          })}
        </svg>
        <div className="h-px w-full bg-border" />
      </div>
    </div>
  )
}
