// lib/payloads/usage.ts — Everything the usage page renders with, in one
// JSON-serializable object.
//
// The page and GET /api/usage read this one function, so both surfaces draw
// their day boundaries from the same server clock and zone.

import {
  getGlobalCostSummary,
  getSpendByDay,
  getSpendByImageModel,
  getSpendByModel,
  getSpendByStory,
  getSpendSince,
} from "@/lib/db/cost-queries"
import { buildSpendWindow, type SpendBar } from "@/lib/spend-window"
import {
  resolveTimeSettings,
  zoneLabel,
  zonedDayKey,
  zonedDayStart,
} from "@/lib/time-zone"
import type {
  GlobalCostSummary,
  ImageModelSpendRow,
  ModelSpendRow,
  StorySpendRow,
} from "@/lib/types"

/** The window the strip covers; also the query's lower bound. */
export const USAGE_WINDOW_DAYS = 30

export interface UsagePayload {
  summary: GlobalCostSummary
  /** One bar per day of the window, oldest first, zero-filled. */
  bars: SpendBar[]
  byStory: StorySpendRow[]
  byModel: ModelSpendRow[]
  byImageModel: ImageModelSpendRow[]
  windowDays: number
  /** Summed in SQL, never from the rounded daily buckets. */
  windowUsd: string
  windowUnpricedCalls: number
  /** BCP-47 tag the server formats in. */
  locale: string
  /** The zone the day boundaries are drawn in, as a caption. */
  zoneLabel: string
}

export async function buildUsagePayload(): Promise<UsagePayload> {
  // One clock for the whole page: the strip's last bucket, the query's lower
  // bound and the window total all have to name the same day. The browser's
  // clock gets no vote — see lib/time-zone.ts.
  const { timeZone, locale } = resolveTimeSettings()
  const today = zonedDayKey(new Date(), timeZone)

  // The window total is asked for rather than summed from the daily buckets:
  // those are already-rounded decimal strings, and adding thirty of them as
  // floats would drift in the digit someone is checking against a credit
  // balance. Postgres does the arithmetic, here as everywhere else.
  const [summary, days, byStory, byModel, byImageModel, window] =
    await Promise.all([
      getGlobalCostSummary(timeZone),
      getSpendByDay(timeZone, USAGE_WINDOW_DAYS),
      getSpendByStory(),
      getSpendByModel(),
      getSpendByImageModel(),
      getSpendSince(zonedDayStart(USAGE_WINDOW_DAYS - 1, timeZone)),
    ])

  return {
    summary,
    bars: buildSpendWindow(days, USAGE_WINDOW_DAYS, today),
    byStory,
    byModel,
    byImageModel,
    windowDays: USAGE_WINDOW_DAYS,
    windowUsd: window.costUsd,
    windowUnpricedCalls: window.unpricedCalls,
    locale,
    zoneLabel: zoneLabel(timeZone, locale),
  }
}
