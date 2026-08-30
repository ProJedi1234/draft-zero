// tests/relative-date.test.ts — Calendar days, not rolling 24-hour windows.
//
// The bug this pins: elapsed-ms math labeled last evening's images "today" all
// the next morning, because they were under 24 hours old. Cases build both
// instants with local-time constructors so they hold in any runner zone.

import { describe, expect, test } from "bun:test"
import { formatRelativeDate } from "@/lib/format"

/** Local wall-clock instant, so the expected day boundary is the local one. */
const local = (y: number, mo: number, d: number, h = 0, min = 0) =>
  new Date(y, mo - 1, d, h, min)

const label = (then: Date, now: Date) =>
  formatRelativeDate(then.toISOString(), now.getTime())

describe("formatRelativeDate", () => {
  const morning = local(2026, 8, 30, 9)

  test("last evening is yesterday, even though it is under 24h ago", () => {
    expect(label(local(2026, 8, 29, 22), morning)).toBe("yesterday")
  })

  test("earlier the same day is today", () => {
    expect(label(local(2026, 8, 30, 0), morning)).toBe("today")
    expect(label(local(2026, 8, 30, 8), morning)).toBe("today")
  })

  test("just before local midnight two nights back is 2d ago", () => {
    expect(label(local(2026, 8, 28, 23, 59), morning)).toBe("2d ago")
  })

  test("longer spans still bucket by day count", () => {
    expect(label(local(2026, 8, 20), morning)).toBe("1w ago")
    expect(label(local(2026, 7, 15), morning)).toBe("1mo ago")
    expect(label(local(2024, 8, 30), morning)).toBe("2y ago")
  })

  test("a clock skewed slightly ahead still reads today, never negative", () => {
    expect(label(local(2026, 8, 30, 10), morning)).toBe("today")
  })
})
