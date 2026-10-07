// lib/waterfall.ts — Where each tile of the gallery's waterfall wall sits.
//
// Placed in script rather than with CSS columns because columns fill top to
// bottom: a newest-first list would run down the first column, and the newest
// picture's neighbour would be the one a screen below it. Shortest-column-first
// keeps the wall reading left to right, and absolute placement keeps DOM order
// equal to list order, so tabbing and screen readers follow the same sequence.
//
// Heights come from each picture's DECLARED ratio, never its loaded pixels, so
// the whole wall is laid out before a single image arrives and never reflows
// as they land.

/** Narrowest a column may get before the wall drops to one fewer. */
export const MIN_COLUMN_WIDTH = 300
/** Even a phone gets two, or a single picture fills the screen. */
export const MIN_COLUMNS = 2
/** Past five, a large display shrinks pictures back toward thumbnails. */
export const MAX_COLUMNS = 5

export interface TilePlacement {
  top: number
  left: number
  width: number
  height: number
}

export interface WaterfallLayout {
  columns: number
  tiles: TilePlacement[]
  /** The wall's total height, so the container can reserve it. */
  height: number
}

/** How many columns fit `width`, each at least MIN_COLUMN_WIDTH wide. */
export function columnCountFor(width: number, gap: number): number {
  const fit = Math.floor((width + gap) / (MIN_COLUMN_WIDTH + gap))
  return Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, fit))
}

/**
 * Places tiles of the given width/height ratios, in order, each into the
 * column that is currently shortest.
 *
 * @param ratios width / height of each tile, in list order.
 * @param width the wall's inner width in CSS pixels.
 * @param gap the space between tiles, both across and down.
 * @returns one placement per ratio, in the same order, plus the wall height.
 */
export function layoutWaterfall(
  ratios: readonly number[],
  width: number,
  gap: number
): WaterfallLayout {
  const columns = columnCountFor(width, gap)
  const columnWidth = (width - gap * (columns - 1)) / columns
  // A gap above the wall, so every tile, the first included, sits one gap
  // below its column's bottom with no empty-column special case.
  const bottoms = new Array<number>(columns).fill(-gap)

  const tiles = ratios.map((ratio) => {
    // Strict less-than, so a tie goes to the leftmost column and the first row
    // fills left to right. Whole-pixel heights keep the ties exact.
    let column = 0
    for (let c = 1; c < columns; c++) {
      if (bottoms[c] < bottoms[column]) column = c
    }
    const top = bottoms[column] + gap
    const height = Math.round(columnWidth / ratio)
    bottoms[column] = top + height
    return {
      top,
      left: column * (columnWidth + gap),
      width: columnWidth,
      height,
    }
  })

  return { columns, tiles, height: Math.max(0, ...bottoms) }
}
