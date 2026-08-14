"use client"

import * as React from "react"

import type { EntrySpendRow } from "@/lib/types"
import { formatUsd } from "@/lib/format"

/** Drawn height of the plot, in viewBox units (1 unit ≈ 1px at rest). */
const PLOT_HEIGHT = 40
/** Bar + gutter. Square bars, so the gutter is the only whitespace. */
const STEP = 3
const BAR_WIDTH = 2
/** Past this many bars the plot stops reading as a shape and starts as noise. */
const MAX_BARS = 120
/** An unpriced passage still happened: a hairline, never a gap. */
const STUB_HEIGHT = 1

type Bucket = {
  /** Summed cost of the passages in this bucket, or null when none were priced. */
  costUsd: number | null
}

/**
 * Fold `perEntry` down to at most MAX_BARS buckets, preserving manuscript order.
 *
 * A bucket is null-costed only when *every* passage in it was unpriced — one
 * known figure is enough to draw a real bar, and rounding the rest to zero
 * inside the bucket understates by less than the alternative (dropping the
 * bucket) misleads.
 */
function bucketEntries(entries: EntrySpendRow[]): Bucket[] {
  if (entries.length === 0) return []

  const perBucket = Math.ceil(entries.length / MAX_BARS)
  if (perBucket <= 1) {
    return entries.map((entry) => ({
      costUsd: entry.costUsd === null ? null : Number.parseFloat(entry.costUsd),
    }))
  }

  const buckets: Bucket[] = []
  for (let i = 0; i < entries.length; i += perBucket) {
    let sum = 0
    let priced = false
    for (const entry of entries.slice(i, i + perBucket)) {
      if (entry.costUsd === null) continue
      const value = Number.parseFloat(entry.costUsd)
      if (!Number.isFinite(value)) continue
      sum += value
      priced = true
    }
    buckets.push({ costUsd: priced ? sum : null })
  }
  return buckets
}

/** "Aug 3" — UTC and month-day only; the year lives nowhere in a sparkline caption. */
function formatDayShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

function formatSpan(span: { firstIso: string; lastIso: string } | null) {
  if (!span) return null
  const first = formatDayShort(span.firstIso)
  const last = formatDayShort(span.lastIso)
  return first === last ? first : `${first} – ${last}`
}

/**
 * Spend over manuscript position — not over wall-clock.
 *
 * A writer asking where the money went thinks "the siege chapter got
 * expensive", not "Tuesday got expensive". So X is position in the manuscript
 * and the calendar is demoted to one line of caption underneath. No axes, no
 * gridlines, no legend, no hover: this is a shape inside a popover the reader
 * already had to summon, and a second hover layer in there is one gesture too
 * many.
 */
export function CostSpark({
  entries,
  totalUsd,
  span,
}: {
  entries: EntrySpendRow[]
  /** Story total, for the screen-reader sentence. Decimal string. */
  totalUsd: string
  /** First and last generated passage, ISO — the caption's date range. */
  span?: { firstIso: string; lastIso: string } | null
}) {
  const buckets = React.useMemo(() => bucketEntries(entries), [entries])

  if (buckets.length === 0) return null

  const max = buckets.reduce(
    (peak, bucket) =>
      bucket.costUsd !== null && bucket.costUsd > peak ? bucket.costUsd : peak,
    0
  )
  const width = buckets.length * STEP
  const caption = formatSpan(span ?? null)
  const label = `Spend across ${entries.length} ${
    entries.length === 1 ? "passage" : "passages"
  }, ${formatUsd(totalUsd)} in total.`

  return (
    <div className="space-y-1.5">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${PLOT_HEIGHT}`}
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
        className="h-10 w-full text-foreground/25"
      >
        {buckets.map((bucket, index) => {
          // Unknown and zero look identical at 1px, which is the honest
          // rendering: both mean "nothing to see here", neither means "$0.00".
          const height =
            bucket.costUsd === null || max === 0
              ? STUB_HEIGHT
              : Math.max(STUB_HEIGHT, (bucket.costUsd / max) * PLOT_HEIGHT)
          return (
            <rect
              key={index}
              x={index * STEP}
              y={PLOT_HEIGHT - height}
              width={BAR_WIDTH}
              height={height}
              fill="currentColor"
            />
          )
        })}
      </svg>
      <p className="font-mono text-[0.625rem] text-muted-foreground tabular-nums">
        {entries.length} {entries.length === 1 ? "passage" : "passages"}
        {caption ? ` · ${caption}` : null}
      </p>
    </div>
  )
}
