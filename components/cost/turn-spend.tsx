"use client"

import * as React from "react"

import { formatUsd } from "@/lib/format"
import type { SpendPart, TurnSpendRow } from "@/lib/types"
import {
  bucketTurns,
  stripLayout,
  TURN_ROWS_MAX,
  turnFigures,
  turnTotal,
  type TurnFigures,
} from "@/lib/turn-spend"
import { cn } from "@/lib/utils"
import { MICRO_LABEL } from "@/components/cost/micro-label"
import {
  partFill,
  purposeInk,
  SpendSwatch,
} from "@/components/cost/spend-swatch"

/** The popover's content width: w-[22rem] less px-4 either side. */
const STRIP_WIDTH = 320
const PLOT_HEIGHT = 40
/** An unpriced turn still happened: a hairline, never a gap. */
const STUB_HEIGHT = 1

const SEGMENTS = [
  { key: "take", part: "take", label: "story" },
  { key: "reroll", part: "reroll", label: "re-rolls" },
  { key: "world", part: "world", label: "world" },
] as const satisfies readonly {
  key: keyof Omit<TurnFigures, "known">
  part: SpendPart
  label: string
}[]

/** "Aug 3" — UTC and month-day only; the year lives nowhere in a caption. */
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

function describe(label: string, figures: TurnFigures): string {
  if (!figures.known) return `${label}: cost not recorded`
  const parts = SEGMENTS.filter(({ key }) => figures[key] > 0).map(
    ({ key, label }) => `${label} ${formatUsd(figures[key])}`
  )
  return `${label}: ${parts.join(" + ")}`
}

function Legend({ present }: { present: Set<string> }) {
  // One kind of segment is named by the section heading; a key would repeat it.
  if (present.size < 2) return null
  return (
    <span className="flex gap-2.5 font-mono text-[0.625rem] text-muted-foreground">
      {SEGMENTS.filter(({ key }) => present.has(key)).map(
        ({ key, part, label }) => (
          <span key={key} className="inline-flex items-center gap-1">
            <SpendSwatch fill={partFill(part)} className="size-1.5" />
            {label}
          </span>
        )
      )}
    </span>
  )
}

function TurnRows({
  rows,
  onJump,
}: {
  rows: TurnSpendRow[]
  onJump: (entryId: string) => void
}) {
  const figures = rows.map(turnFigures)
  const max = Math.max(0, ...figures.map(turnTotal))

  return (
    <div className="flex flex-col">
      {rows.map((row, index) => {
        const turn = figures[index]
        const total = turnTotal(turn)
        return (
          <button
            key={row.entryId}
            type="button"
            title={describe(`#${row.position}`, turn)}
            aria-label={`${describe(`#${row.position}`, turn)}. Jump to passage.`}
            onClick={() => onJump(row.entryId)}
            className="-mx-2 grid grid-cols-[2rem_1fr_3.5rem] items-center gap-2.5 rounded-sm px-2 py-[3px] text-left font-mono text-xs outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-muted-foreground tabular-nums">
              #{row.position}
            </span>
            <span
              className="flex h-1.5 gap-0.5"
              style={{ width: max > 0 ? `${(total / max) * 100}%` : 0 }}
            >
              {SEGMENTS.filter(({ key }) => turn[key] > 0).map(
                ({ key, part }) => (
                  <span
                    key={key}
                    className={cn(
                      "h-full basis-0 rounded-[1px]",
                      partFill(part)
                    )}
                    style={{ flexGrow: turn[key] * 1e6 }}
                  />
                )
              )}
            </span>
            <span className="text-right tabular-nums">
              {turn.known ? formatUsd(total) : "—"}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function TurnStrip({
  rows,
  span,
}: {
  rows: TurnSpendRow[]
  span: { firstIso: string; lastIso: string } | null
}) {
  const hatchId = React.useId()
  const layout = stripLayout(rows.length, STRIP_WIDTH)
  const buckets = bucketTurns(rows, layout.perBar)
  const peak = Math.max(0, ...buckets.map(turnTotal))

  let priciest = 0
  const figures = rows.map(turnFigures)
  figures.forEach((turn, index) => {
    if (turnTotal(turn) > turnTotal(figures[priciest])) priciest = index
  })
  const pick = rows[priciest]
  const pickBucket = Math.floor(priciest / layout.perBar)
  const width = layout.bars * layout.step
  const caption = formatSpan(span)

  return (
    <div className="space-y-1.5">
      <svg
        role="img"
        aria-label={`Spend across ${rows.length} passages. Priciest is #${pick.position} at ${formatUsd(turnTotal(figures[priciest]))}.`}
        width={width}
        height={PLOT_HEIGHT + 4}
        viewBox={`0 0 ${width} ${PLOT_HEIGHT + 4}`}
        shapeRendering="crispEdges"
        className="block"
      >
        <defs>
          <pattern
            id={hatchId}
            width="3.5"
            height="3.5"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
            className={purposeInk("story")}
          >
            <rect width="1.5" height="3.5" fill="currentColor" />
          </pattern>
        </defs>
        {buckets.map((bucket, index) => {
          const x = index * layout.step
          const label = describe(
            layout.perBar === 1
              ? `#${bucket.first.position}`
              : `#${bucket.first.position}–${bucket.last.position}`,
            bucket
          )
          let base = PLOT_HEIGHT
          let stacked = false
          return (
            <g key={bucket.first.entryId}>
              <title>{label}</title>
              {!bucket.known || peak === 0 ? (
                <rect
                  x={x}
                  y={PLOT_HEIGHT - STUB_HEIGHT}
                  width={layout.barWidth}
                  height={STUB_HEIGHT}
                  className="fill-muted-foreground/40"
                />
              ) : (
                SEGMENTS.map(({ key }) => {
                  const height = (bucket[key] / peak) * PLOT_HEIGHT
                  if (height < 1) return null
                  // A 1px surface gap between stacked segments.
                  const gap = stacked ? 1 : 0
                  base -= height
                  stacked = true
                  return (
                    <rect
                      key={key}
                      x={x}
                      y={base}
                      width={layout.barWidth}
                      height={Math.max(1, height - gap)}
                      fill={
                        key === "reroll" ? `url(#${hatchId})` : "currentColor"
                      }
                      className={
                        key === "world"
                          ? purposeInk("memory")
                          : purposeInk("story")
                      }
                    />
                  )
                })
              )}
              <rect
                x={x}
                y={0}
                width={layout.step}
                height={PLOT_HEIGHT}
                fill="transparent"
              />
            </g>
          )
        })}
        <rect
          x={pickBucket * layout.step}
          y={PLOT_HEIGHT + 2}
          width={layout.barWidth}
          height={2}
          className="fill-foreground"
        />
      </svg>
      <p className="font-mono text-[0.625rem] text-muted-foreground tabular-nums">
        {rows.length} passages
        {layout.perBar > 1 ? ` · ${layout.perBar} per bar` : null}
        {caption ? ` · ${caption}` : null}
      </p>
      <p className="font-mono text-[0.6875rem] tabular-nums">
        Priciest: #{pick.position} · {formatUsd(turnTotal(figures[priciest]))}
        {pick.rerolls > 0 ? (
          <span className="text-muted-foreground">
            {" "}
            · {pick.rerolls} {pick.rerolls === 1 ? "re-roll" : "re-rolls"}
          </span>
        ) : null}
      </p>
    </div>
  )
}

/**
 * What each turn cost, story and the world pass it caused stacked together.
 * A short story lists its turns, and each row jumps to its passage. A long one
 * gets a strip of fixed-width bars that never stretch to fill the panel.
 */
export function TurnSpend({
  rows,
  span,
  onJump,
}: {
  rows: TurnSpendRow[]
  span: { firstIso: string; lastIso: string } | null
  onJump: (entryId: string) => void
}) {
  const present = new Set<string>()
  for (const row of rows) {
    const turn = turnFigures(row)
    for (const { key } of SEGMENTS) if (turn[key] > 0) present.add(key)
  }
  const listed = rows.length <= TURN_ROWS_MAX

  return (
    <section className="border-t px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className={MICRO_LABEL}>
          {listed ? "Per turn" : "Across the manuscript"}
        </h2>
        <Legend present={present} />
      </div>
      {listed ? (
        <TurnRows rows={rows} onJump={onJump} />
      ) : (
        <TurnStrip rows={rows} span={span} />
      )}
    </section>
  )
}
