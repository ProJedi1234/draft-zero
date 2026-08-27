import type { Metadata } from "next"

import { UsageView } from "@/components/usage/usage-view"
import { buildSpendWindow } from "@/lib/spend-window"
import {
  resolveTimeSettings,
  zoneLabel,
  zonedDayKey,
  zonedDayStart,
} from "@/lib/time-zone"
import {
  getGlobalCostSummary,
  getSpendByDay,
  getSpendByImageModel,
  getSpendByModel,
  getSpendByStory,
  getSpendSince,
} from "@/lib/db/cost-queries"

export const metadata: Metadata = {
  title: "Usage",
}

/** The window the strip covers; also the query's lower bound. */
const WINDOW_DAYS = 30

export default async function UsagePage() {
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
      getSpendByDay(timeZone, WINDOW_DAYS),
      getSpendByStory(),
      getSpendByModel(),
      getSpendByImageModel(),
      getSpendSince(zonedDayStart(WINDOW_DAYS - 1, timeZone)),
    ])

  return (
    <UsageView
      summary={summary}
      bars={buildSpendWindow(days, WINDOW_DAYS, today)}
      byStory={byStory}
      byModel={byModel}
      byImageModel={byImageModel}
      windowDays={WINDOW_DAYS}
      windowUsd={window.costUsd}
      windowUnpricedCalls={window.unpricedCalls}
      locale={locale}
      zoneLabel={zoneLabel(timeZone, locale)}
    />
  )
}
