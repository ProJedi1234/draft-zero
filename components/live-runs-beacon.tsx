"use client"

// components/live-runs-beacon.tsx — Publishes the server's active-run list to
// the client, for use-generation's recovery probe.
//
// Renders nothing. A component rather than a prop because the list is read in
// the root layout while the hook that wants it lives in the story subtree, and
// threading it down would re-render the manuscript on every RSC payload.

import * as React from "react"

import { liveRuns } from "@/lib/sync/client"
import type { ActiveRun } from "@/lib/sync/types"

export function LiveRunsBeacon({ runs }: { runs: ActiveRun[] }) {
  // In an effect, not during render: publish() calls subscribers, and one that
  // re-renders would be setting state during this component's render. `runs` is
  // a fresh array per server render, which is the intended cadence.
  React.useEffect(() => {
    liveRuns.publish(runs)
  }, [runs])

  return null
}
