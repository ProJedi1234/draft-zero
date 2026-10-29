// tests/turn-spend.test.ts — The ledger's per-turn layout. The original bug
// was a three-passage chart stretched to fill the panel, so the width rules
// are pinned here rather than left to a screenshot.
import { describe, expect, test } from "bun:test"

import {
  bucketTurns,
  stripLayout,
  turnFigures,
  turnTotal,
} from "@/lib/turn-spend"
import type { TurnSpendRow } from "@/lib/types"

function turn(
  position: number,
  takeUsd: string | null,
  rest: Partial<TurnSpendRow> = {}
): TurnSpendRow {
  return {
    entryId: `e${position}`,
    position,
    takeUsd,
    rerollUsd: null,
    rerolls: 0,
    worldUsd: null,
    unpricedCalls: 0,
    ...rest,
  }
}

describe("stripLayout", () => {
  test("a short strip keeps narrow bars and leaves the rest of the width empty", () => {
    expect(stripLayout(17, 320)).toEqual({
      perBar: 1,
      bars: 17,
      step: 12,
      barWidth: 10,
    })
  })

  test("a medium strip fills the width with whole-pixel bars", () => {
    expect(stripLayout(52, 320)).toEqual({
      perBar: 1,
      bars: 52,
      step: 6,
      barWidth: 4,
    })
  })

  test("a long strip groups whole passages per bar", () => {
    const layout = stripLayout(165, 320)
    expect(layout).toEqual({ perBar: 2, bars: 83, step: 3, barWidth: 2 })
    expect(layout.bars * layout.step).toBeLessThanOrEqual(320)
  })
})

describe("turn figures", () => {
  test("an unpriced turn is unknown, not free", () => {
    const figures = turnFigures(turn(2, null))
    expect(figures.known).toBe(false)
    expect(turnTotal(figures)).toBe(0)
  })

  test("a turn adds its take, re-rolls and world pass", () => {
    const figures = turnFigures(
      turn(2, "0.010", { rerollUsd: "0.020", worldUsd: "0.003" })
    )
    expect(figures.known).toBe(true)
    expect(turnTotal(figures)).toBeCloseTo(0.033, 10)
  })

  test("buckets keep their first and last passage for the tooltip", () => {
    const buckets = bucketTurns(
      [turn(2, "0.01"), turn(4, null), turn(6, "0.02")],
      2
    )
    expect(buckets).toHaveLength(2)
    expect(buckets[0].first.position).toBe(2)
    expect(buckets[0].last.position).toBe(4)
    expect(buckets[0].known).toBe(true)
    expect(buckets[0].take).toBeCloseTo(0.01, 10)
    expect(buckets[1].first).toBe(buckets[1].last)
  })
})
