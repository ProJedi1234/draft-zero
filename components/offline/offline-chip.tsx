"use client"

// components/offline/offline-chip.tsx — The standing fact, in the header's
// chip row beside the save status and the cost.
//
// This is what survives the banner folding away, and it is the reason the
// banner is allowed to fold away at all: the ✕ collapses rather than
// dismisses, and this is what it collapses INTO. Renders nothing while online,
// on the same principle as AtmosphereChip — a green light nobody asked for is
// noise, and the absence of this chip is the "everything is fine" state.
//
// Tapping it opens the panel rather than re-expanding the banner. Collapsing
// an announcement must not put the answers further away than they were.

import { CloudOff } from "lucide-react"

import { useOffline } from "@/components/offline/offline-provider"
import { bannerIsVisible } from "@/lib/net/banner"
import { useStoreView } from "@/hooks/use-store"
import { cn } from "@/lib/utils"

export function OfflineChip({ className }: { className?: string }) {
  const offline = useOffline()
  const { pendingCount } = useStoreView()

  // Hidden while a banner is up, so the two never say the same thing at once.
  // The banner folding away IS the chip appearing — one object becomes the
  // other, which is what makes "collapse" read as collapsing rather than as
  // something vanishing and something unrelated showing up.
  if (offline === null || !offline.offline) return null
  if (bannerIsVisible(offline.phase)) return null

  const held = pendingCount > 0

  return (
    <button
      type="button"
      onClick={() => offline.setPanelOpen(true)}
      // polite rather than assertive for the same reason as the banner, and
      // labelled rather than title-attributed because the visible text is two
      // glyphs and a number.
      aria-live="polite"
      aria-label={
        held
          ? `Offline. ${pendingCount} ${pendingCount === 1 ? "change" : "changes"} held on this device. Open offline details.`
          : "Offline. Open offline details."
      }
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning transition-colors hover:bg-warning/25",
        className
      )}
    >
      <CloudOff className="size-3" />
      {held ? <span className="tabular-nums">{pendingCount}</span> : null}
      <span className="sr-only">Offline</span>
    </button>
  )
}
