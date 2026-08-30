"use client"

// components/live-runs-beacon.tsx — Publishes the server's active-run list into
// the client, so the story workspace can be corrected by it.
//
// Renders nothing. It exists because the list is read in the root layout (the
// registries are Maps in this process, not a query) while the hook that needs
// it lives in the story subtree, and passing it down would re-render the
// manuscript on every RSC payload to hand one string to one hook.
//
// The layout re-renders on every router.refresh() the app already performs, so
// this fires on exactly the beat the sidebar's marks update on — which is what
// makes it a recovery path rather than a poll.

import * as React from "react"

import { liveRuns } from "@/lib/sync/client"
import type { ActiveRun } from "@/lib/sync/types"

export function LiveRunsBeacon({ runs }: { runs: ActiveRun[] }) {
  // In an effect, not during render: publish() calls subscribers, and a
  // subscriber that re-renders in response would be setting state during this
  // component's render. `runs` is a fresh array per server render, which is
  // the intended cadence — the effect is meant to fire on every payload.
  React.useEffect(() => {
    liveRuns.publish(runs)
  }, [runs])

  return null
}
