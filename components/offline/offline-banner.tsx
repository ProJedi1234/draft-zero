"use client"

// components/offline/offline-banner.tsx — The announcement, and only the
// announcement. What persists after it folds away is the chip; see
// offline-provider.tsx for which surface owns what.

import * as React from "react"
import { CloudOff, RefreshCw, TriangleAlert, Wifi, X } from "lucide-react"

import { useOffline } from "@/components/offline/offline-provider"
import { Button } from "@/components/ui/button"
import { useStoreView } from "@/hooks/use-store"
import { bannerIsVisible } from "@/lib/net/banner"
import { probeConnection } from "@/lib/net/connection"
import { cn } from "@/lib/utils"

export function OfflineBanner() {
  const offline = useOffline()
  const { pendingCount } = useStoreView()
  const [checking, setChecking] = React.useState(false)

  if (offline === null) return null
  const { phase, lastFailure, collapse, setPanelOpen } = offline

  // `held` is the resting offline state and deliberately renders nothing. The
  // chip is what remains, and reclaiming this row is the entire point of it.
  if (!bannerIsVisible(phase)) return null

  const check = async () => {
    setChecking(true)
    try {
      await probeConnection()
    } finally {
      setChecking(false)
    }
  }

  const tone =
    phase === "failed"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : phase === "restored"
        ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
        : "border-warning/30 bg-warning/10 text-warning"

  return (
    <div
      // polite, not assertive: this is worth reading, and it is never so
      // urgent that it should cut across whatever a screen reader is saying.
      role="status"
      aria-live="polite"
      className={cn("flex items-start gap-3 border-b px-4 py-2 text-sm", tone)}
    >
      <Icon phase={phase} />

      <div className="min-w-0 flex-1 space-y-0.5">
        <Headline phase={phase} lastFailure={lastFailure} />
        <Detail phase={phase} pendingCount={pendingCount} />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {phase !== "restored" ? (
          <Button
            variant="outline"
            size="xs"
            onClick={phase === "failed" ? () => setPanelOpen(true) : check}
            disabled={checking}
            className="border-current/30 text-current"
          >
            {phase === "failed" ? "See" : checking ? "Checking…" : "Check"}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={collapse}
          className="text-current"
          // "Collapse", never "Dismiss". The word is the contract: the
          // condition survives this button and the chip proves it.
          aria-label="Collapse this message"
        >
          <X />
        </Button>
      </div>
    </div>
  )
}

function Icon({ phase }: { phase: string }) {
  const className = "mt-0.5 size-4 shrink-0"
  if (phase === "failed") return <TriangleAlert className={className} />
  if (phase === "restored") return <Wifi className={className} />
  return <CloudOff className={className} />
}

function Headline({
  phase,
  lastFailure,
}: {
  phase: string
  lastFailure: string | null
}) {
  if (phase === "failed") {
    return (
      <p className="font-medium">
        {lastFailure === null
          ? "A change could not be sent"
          : `Could not send: ${lastFailure}`}
      </p>
    )
  }
  if (phase === "restored") return <p className="font-medium">Back online</p>
  return <p className="font-medium">You are offline</p>
}

function Detail({
  phase,
  pendingCount,
}: {
  phase: string
  pendingCount: number
}) {
  if (phase === "failed") {
    return (
      <p className="text-xs opacity-80">
        It has been undone here. Nothing else is affected.
      </p>
    )
  }
  if (phase === "restored") {
    // pendingCount can still be positive here: this phase is set the instant
    // the connection flips to online, but the queue drains asynchronously —
    // each held write is its own round trip. Claiming they are all sent
    // while some are still in flight is exactly the kind of thing "nothing
    // fake stays fake" forbids.
    return (
      <p className="text-xs opacity-80">
        {pendingCount > 0
          ? `Sending ${pendingCount} held ${pendingCount === 1 ? "change" : "changes"}…`
          : "Everything held has been sent."}
      </p>
    )
  }
  return (
    <p className="text-xs opacity-80">
      Reading and writing still work.
      {pendingCount > 0
        ? ` ${pendingCount} ${pendingCount === 1 ? "change is" : "changes are"} held on this device.`
        : ""}
    </p>
  )
}

/** Re-exported so the story header can show the spinner state on its own check. */
export { RefreshCw as CheckSpinner }
