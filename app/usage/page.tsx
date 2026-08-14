import type { Metadata } from "next"

import { UsageView } from "@/components/usage/usage-view"
import { buildSpendWindow } from "@/lib/spend-window"
import {
  getGlobalCostSummary,
  getSpendByDay,
  getSpendByModel,
  getSpendByStory,
  getSpendSince,
  utcDayStart,
} from "@/lib/db/cost-queries"

export const metadata: Metadata = {
  title: "Usage",
}

/** The window the strip covers; also the query's lower bound. */
const WINDOW_DAYS = 30

export default async function UsagePage() {
  // One clock for the whole page. The strip's last bucket, the query's lower
  // bound and the exact window total all have to name the same day, and the
  // browser's clock is not entitled to a vote: it can sit on the other side of
  // UTC midnight from the server, which drew a strip that disagreed with its
  // own caption and mismatched what SSR had rendered.
  const today = utcDayStart(0).slice(0, 10)

  // The window total is asked for rather than summed from the daily buckets:
  // those are already-rounded decimal strings, and adding thirty of them as
  // floats would drift in the digit someone is checking against a credit
  // balance. Postgres does the arithmetic, here as everywhere else.
  const [summary, days, byStory, byModel, window] = await Promise.all([
    getGlobalCostSummary(),
    getSpendByDay(WINDOW_DAYS),
    getSpendByStory(),
    getSpendByModel(),
    getSpendSince(utcDayStart(WINDOW_DAYS - 1)),
  ])

  return (
    <UsageView
      summary={summary}
      bars={buildSpendWindow(days, WINDOW_DAYS, today)}
      byStory={byStory}
      byModel={byModel}
      windowDays={WINDOW_DAYS}
      windowUsd={window.costUsd}
      windowUnpricedCalls={window.unpricedCalls}
    />
  )
}
