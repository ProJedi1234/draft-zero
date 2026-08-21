// lib/time-zone.ts — Which clock the app's day boundaries are drawn against.
//
// Resolve ON THE SERVER, once per render, and pass the result down. Reading a
// zone during a client render puts the server and the browser on opposite sides
// of a day boundary, which is a hydration mismatch and a caption whose total no
// longer describes the bars beside it.

export interface TimeSettings {
  /** IANA zone id — "America/New_York". Day boundaries are drawn here. */
  timeZone: string
  /** BCP-47 tag — "en-US". Formatting only; never picks which day a row is in. */
  locale: string
}

function usableTimeZone(zone: string | undefined): string | null {
  if (!zone) return null
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone })
    return zone
  } catch {
    return null
  }
}

function usableLocale(locale: string | undefined): string | null {
  if (!locale) return null
  try {
    new Intl.DateTimeFormat(locale)
    return locale
  } catch {
    return null
  }
}

/**
 * Override, then environment, then the host, then UTC. A bad zone falls through
 * rather than throwing: it should cost a wrong boundary, not a 500 on /usage.
 *
 * `override` is the seam a stored per-user preference lands on later.
 */
export function resolveTimeSettings(
  override: Partial<TimeSettings> = {}
): TimeSettings {
  const host = Intl.DateTimeFormat().resolvedOptions()

  return {
    timeZone:
      usableTimeZone(override.timeZone) ??
      usableTimeZone(process.env.DRAFT_ZERO_TIME_ZONE) ??
      usableTimeZone(host.timeZone) ??
      "UTC",
    locale:
      usableLocale(override.locale) ??
      usableLocale(process.env.DRAFT_ZERO_LOCALE) ??
      usableLocale(host.locale) ??
      "en-US",
  }
}

/** Cached — zonedDayStart builds three of these per call and they are not cheap. */
const formatters = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let hit = formatters.get(timeZone)
  if (!hit) {
    hit = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    formatters.set(timeZone, hit)
  }
  return hit
}

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** What a wall clock in `timeZone` reads at `instant`. */
function wallClock(instant: Date, timeZone: string): WallClock {
  const parts = partsFormatter(timeZone).formatToParts(instant)
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0")

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  }
}

/**
 * The zone's UTC offset at `instant`, in ms. Intl exposes no offset directly,
 * but reading the wall clock and interpreting those numbers AS IF they were UTC
 * differs from the real instant by exactly the offset.
 */
function offsetMs(instant: Date, timeZone: string): number {
  const w = wallClock(instant, timeZone)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  // Floored to seconds because that is the finest grain the formatter reports.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/** "2026-08-21" — the calendar day `instant` falls on in `timeZone`. */
export function zonedDayKey(instant: Date, timeZone: string): string {
  const w = wallClock(instant, timeZone)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`
}

/**
 * The UTC instant local midnight `daysAgo` days back began, as ISO — the lower
 * bound for a query over a zoned window.
 *
 * `now` is injectable so the DST cases can be tested; callers pass nothing.
 */
export function zonedDayStart(
  daysAgo: number,
  timeZone: string,
  now: Date = new Date()
): string {
  const w = wallClock(now, timeZone)
  // Date.UTC despite the zone: this is still a naive date, not an instant.
  const naive = Date.UTC(w.year, w.month - 1, w.day - Math.max(0, daysAgo))

  // Twice, because the offset we need is the one at an instant not yet found:
  // the first pass gets close, the second re-reads it there. That is what makes
  // a window straddling a DST change land on the right hour.
  const approx = naive - offsetMs(new Date(naive), timeZone)
  const exact = naive - offsetMs(new Date(approx), timeZone)

  return new Date(exact).toISOString()
}

/** "EDT", or "GMT+5:30" where the zone has no abbreviation; the id as a floor. */
export function zoneLabel(timeZone: string, locale: string): string {
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(new Date())
    return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone
  } catch {
    return timeZone
  }
}
