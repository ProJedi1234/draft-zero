// lib/turn-spend.ts — Layout for the ledger's per-turn spend.
//
// Display arithmetic only. The figures arrive as SQL-summed decimal strings
// and are parsed here to size bars; no total shown as text is built from them.

import type { TurnSpendRow } from "@/lib/types"

/** At or under this many turns the ledger lists them; past it, it draws a strip. */
export const TURN_ROWS_MAX = 12

/** Narrowest step that still reads as a bar beside its neighbour. */
const MIN_STEP = 3
/** Widest step: a handful of passages must not swell into blocks. */
const MAX_STEP = 12

export interface TurnFigures {
  take: number
  reroll: number
  world: number
  /** False when no call in the turn was priced, so zero means "unknown". */
  known: boolean
}

function parse(usd: string | null): number | null {
  if (usd === null) return null
  const value = Number.parseFloat(usd)
  return Number.isFinite(value) ? value : null
}

export function turnFigures(row: TurnSpendRow): TurnFigures {
  const take = parse(row.takeUsd)
  const reroll = parse(row.rerollUsd)
  const world = parse(row.worldUsd)
  return {
    take: take ?? 0,
    reroll: reroll ?? 0,
    world: world ?? 0,
    known: take !== null || reroll !== null || world !== null,
  }
}

export function turnTotal(figures: TurnFigures): number {
  return figures.take + figures.reroll + figures.world
}

export interface StripLayout {
  /** Whole passages per bar, so no bar sums a fraction of one. */
  perBar: number
  bars: number
  /** Bar plus gutter, in CSS pixels. */
  step: number
  barWidth: number
}

/** Fixed-pixel bars: a short manuscript leaves space rather than stretching. */
export function stripLayout(turns: number, width: number): StripLayout {
  const maxBars = Math.floor(width / MIN_STEP)
  const perBar = Math.max(1, Math.ceil(turns / maxBars))
  const bars = Math.ceil(turns / perBar)
  const step = Math.min(
    MAX_STEP,
    Math.max(MIN_STEP, Math.floor(width / Math.max(1, bars)))
  )
  return { perBar, bars, step, barWidth: step - (step >= 6 ? 2 : 1) }
}

export interface TurnBucket extends TurnFigures {
  first: TurnSpendRow
  last: TurnSpendRow
}

export function bucketTurns(
  rows: TurnSpendRow[],
  perBar: number
): TurnBucket[] {
  const buckets: TurnBucket[] = []
  for (let i = 0; i < rows.length; i += perBar) {
    const slice = rows.slice(i, i + perBar)
    const bucket: TurnBucket = {
      take: 0,
      reroll: 0,
      world: 0,
      known: false,
      first: slice[0],
      last: slice[slice.length - 1],
    }
    for (const row of slice) {
      const figures = turnFigures(row)
      bucket.take += figures.take
      bucket.reroll += figures.reroll
      bucket.world += figures.world
      bucket.known ||= figures.known
    }
    buckets.push(bucket)
  }
  return buckets
}
