// tests/waterfall.test.ts — Where the gallery's waterfall puts each tile.
//
// The wall is laid out from declared ratios alone, so the whole rule is a
// ratios → rectangles function. These pin the two promises it makes: the
// column count scales with width inside fixed bounds, and the wall reads in
// list order, left to right, without leaving a short column unfilled.

import { describe, expect, test } from "bun:test"

import {
  MAX_COLUMNS,
  MIN_COLUMNS,
  columnCountFor,
  layoutWaterfall,
} from "@/lib/waterfall"

const GAP = 4

describe("columnCountFor", () => {
  test("a phone still gets two columns", () => {
    expect(columnCountFor(382, GAP)).toBe(MIN_COLUMNS)
  })

  test("a 1920 display beside the sidebar gets five", () => {
    expect(columnCountFor(1656, GAP)).toBe(5)
  })

  test("a laptop beside the sidebar gets three", () => {
    expect(columnCountFor(1176, GAP)).toBe(3)
  })

  test("an ultrawide stops at the ceiling rather than shrinking tiles", () => {
    expect(columnCountFor(3800, GAP)).toBe(MAX_COLUMNS)
  })
})

describe("layoutWaterfall", () => {
  test("the first row fills left to right", () => {
    const { tiles } = layoutWaterfall([1, 1, 1], 1000, GAP)
    expect(tiles.map((t) => t.top)).toEqual([0, 0, 0])
    expect(tiles[0].left).toBeLessThan(tiles[1].left)
    expect(tiles[1].left).toBeLessThan(tiles[2].left)
  })

  test("tiles span the wall exactly, gaps included", () => {
    const { tiles } = layoutWaterfall([1, 1, 1], 1000, GAP)
    const last = tiles[2]
    expect(last.left + last.width).toBeCloseTo(1000)
  })

  test("each tile keeps its picture's ratio", () => {
    const { tiles } = layoutWaterfall([16 / 9, 1, 9 / 16], 1000, GAP)
    for (const [i, ratio] of [16 / 9, 1, 9 / 16].entries()) {
      expect(Math.abs(tiles[i].width / ratio - tiles[i].height)).toBeLessThan(1)
    }
  })

  test("the next tile drops into the shortest column", () => {
    // Column 0 holds a tall portrait, column 1 a short landscape, column 2 a
    // square: the fourth tile belongs under the landscape.
    const { tiles } = layoutWaterfall([9 / 16, 16 / 9, 1, 1], 1000, GAP)
    expect(tiles[3].left).toBe(tiles[1].left)
    expect(tiles[3].top).toBe(tiles[1].height + GAP)
  })

  test("the wall is as tall as its tallest column", () => {
    const { tiles, height } = layoutWaterfall([9 / 16, 1, 1, 1], 1000, GAP)
    expect(height).toBe(Math.max(...tiles.map((t) => t.top + t.height)))
  })

  test("an empty wall has no height", () => {
    expect(layoutWaterfall([], 1000, GAP)).toEqual({
      columns: 3,
      tiles: [],
      height: 0,
    })
  })
})
