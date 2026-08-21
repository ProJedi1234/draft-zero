// tests/zoned-day.test.ts — The day boundary the whole usage page is drawn
// against.
//
// Worth pinning because every failure here is silent: a boundary off by an hour
// still renders a strip that adds up, it just files late-evening generations
// under the wrong day. The cases are where zone math actually breaks — the two
// DST transitions, and sub-hour offsets that whole-hour arithmetic passes right
// over.

import { describe, expect, test } from "bun:test"

import {
  resolveTimeSettings,
  zoneLabel,
  zonedDayKey,
  zonedDayStart,
} from "@/lib/time-zone"

/** Noon in the zone on `day` — a safe "now" from which to count days back. */
function noonOn(day: string, timeZone: string): Date {
  // Any instant inside the local day works; noon is the one no DST rule moves.
  const guess = new Date(`${day}T12:00:00Z`)
  const shift = Date.parse(zonedDayStart(0, timeZone, guess))
  return new Date(shift + 12 * 60 * 60 * 1000)
}

const NY = "America/New_York"

describe("zonedDayStart — today's boundary", () => {
  test("a plain summer day starts at 04:00 UTC in New York", () => {
    expect(zonedDayStart(0, NY, noonOn("2026-08-21", NY))).toBe(
      "2026-08-21T04:00:00.000Z"
    )
  })

  test("a plain winter day starts at 05:00 UTC — the offset is not a constant", () => {
    expect(zonedDayStart(0, NY, noonOn("2026-01-15", NY))).toBe(
      "2026-01-15T05:00:00.000Z"
    )
  })

  test("UTC is still exactly midnight, so nothing regressed for a UTC host", () => {
    expect(zonedDayStart(0, "UTC", noonOn("2026-08-21", "UTC"))).toBe(
      "2026-08-21T00:00:00.000Z"
    )
  })

  test("a half-hour zone is not rounded to the hour", () => {
    expect(
      zonedDayStart(0, "Asia/Kolkata", noonOn("2026-08-21", "Asia/Kolkata"))
    ).toBe("2026-08-20T18:30:00.000Z")
  })

  test("a 45-minute zone lands on the quarter hour", () => {
    expect(
      zonedDayStart(0, "Asia/Kathmandu", noonOn("2026-08-21", "Asia/Kathmandu"))
    ).toBe("2026-08-20T18:15:00.000Z")
  })
})

describe("zonedDayStart — counting back across a DST change", () => {
  // The reason the offset is read twice. Standing after the change and counting
  // back to before it, the offset at the answer is not the offset at today.

  test("the day clocks sprang forward began at the pre-jump offset", () => {
    // Standing on the 10th (EDT), the 8th began at 00:00 EST. A one-pass
    // implementation says 04:00Z and loses an hour of that day to the 7th.
    expect(zonedDayStart(2, NY, noonOn("2026-03-10", NY))).toBe(
      "2026-03-08T05:00:00.000Z"
    )
  })

  test("the day after the jump began at the post-jump offset", () => {
    expect(zonedDayStart(1, NY, noonOn("2026-03-10", NY))).toBe(
      "2026-03-09T04:00:00.000Z"
    )
  })

  test("counting back over the autumn change picks up the summer offset", () => {
    // Standing on the 3rd (EST), the 1st began at 00:00 EDT (-04:00).
    expect(zonedDayStart(2, NY, noonOn("2026-11-03", NY))).toBe(
      "2026-11-01T04:00:00.000Z"
    )
  })

  test("a 30-day window over a DST change is still 30 calendar days back", () => {
    expect(zonedDayStart(29, NY, noonOn("2026-04-01", NY))).toBe(
      "2026-03-03T05:00:00.000Z"
    )
  })

  test("the window rolls back over a month boundary, and a year one", () => {
    expect(zonedDayStart(6, NY, noonOn("2026-01-03", NY))).toBe(
      "2025-12-28T05:00:00.000Z"
    )
  })

  test("a negative days-ago is clamped rather than reaching into the future", () => {
    const today = zonedDayStart(0, NY, noonOn("2026-08-21", NY))
    expect(zonedDayStart(-5, NY, noonOn("2026-08-21", NY))).toBe(today)
  })
})

describe("zonedDayKey", () => {
  // The case the old `left(created_at, 10)` got wrong: an evening generation in
  // New York is already tomorrow in UTC, and used to be filed there.
  test("a late New York evening is still that day, not tomorrow", () => {
    const evening = new Date("2026-08-22T02:30:00Z") // 22:30 on the 21st, EDT
    expect(zonedDayKey(evening, "America/New_York")).toBe("2026-08-21")
    expect(zonedDayKey(evening, "UTC")).toBe("2026-08-22")
  })

  test("an early Tokyo morning is already the next day", () => {
    const morning = new Date("2026-08-21T22:00:00Z") // 07:00 on the 22nd, JST
    expect(zonedDayKey(morning, "Asia/Tokyo")).toBe("2026-08-22")
  })

  test("midnight itself belongs to the day it opens", () => {
    expect(
      zonedDayKey(new Date("2026-08-21T04:00:00Z"), "America/New_York")
    ).toBe("2026-08-21")
  })

  test("months and years pad to two digits, so keys sort lexicographically", () => {
    expect(zonedDayKey(new Date("2026-01-05T12:00:00Z"), "UTC")).toBe(
      "2026-01-05"
    )
  })
})

describe("resolveTimeSettings", () => {
  test("an unusable zone falls back rather than throwing the page away", () => {
    // A bad TZ should cost a wrong day boundary, never a 500 on /usage.
    expect(
      resolveTimeSettings({ timeZone: "Mars/Olympus_Mons" }).timeZone
    ).not.toBe("Mars/Olympus_Mons")
  })

  test("an explicit override wins — the seam a stored preference lands on", () => {
    const settings = resolveTimeSettings({
      timeZone: "Asia/Kolkata",
      locale: "en-GB",
    })
    expect(settings.timeZone).toBe("Asia/Kolkata")
    expect(settings.locale).toBe("en-GB")
  })

  test("the resolved zone is always usable by Intl", () => {
    const { timeZone } = resolveTimeSettings()
    expect(() => new Intl.DateTimeFormat("en-US", { timeZone })).not.toThrow()
  })
})

describe("zoneLabel", () => {
  test("names a zone the way the caption promises", () => {
    expect(zoneLabel("America/New_York", "en-US")).toMatch(/^E[DS]T$/)
    expect(zoneLabel("UTC", "en-US")).toBe("UTC")
  })

  test("a zone without an abbreviation still gets something readable", () => {
    expect(zoneLabel("Asia/Kolkata", "en-US")).toMatch(/GMT\+5:30/)
  })

  test("an unusable zone degrades to its own id, never to a throw", () => {
    expect(zoneLabel("Mars/Olympus_Mons", "en-US")).toBe("Mars/Olympus_Mons")
  })
})
