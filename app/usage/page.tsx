import type { Metadata } from "next"

import { UsageView } from "@/components/usage/usage-view"
import { buildUsagePayload } from "@/lib/payloads/usage"

export const metadata: Metadata = {
  title: "Usage",
}

export default async function UsagePage() {
  const payload = await buildUsagePayload()

  return (
    <UsageView
      summary={payload.summary}
      bars={payload.bars}
      byStory={payload.byStory}
      byModel={payload.byModel}
      byImageModel={payload.byImageModel}
      windowDays={payload.windowDays}
      windowUsd={payload.windowUsd}
      windowUnpricedCalls={payload.windowUnpricedCalls}
      locale={payload.locale}
      zoneLabel={payload.zoneLabel}
    />
  )
}
