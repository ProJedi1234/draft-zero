"use client"

// components/offline/offline-provider.tsx — Who is allowed to say what, and
// for how long.
//
// Three surfaces share one piece of state and each has exactly one job:
//
//   The banner announces a TRANSITION. It is loud, it takes a row, and it
//   goes away on its own.
//   The chip is the standing FACT. It costs no layout, it never leaves while
//   the condition holds, and it is the only thing that survives the banner.
//   The panel is the DETAIL, and it opens from the chip.
//
// The rule that makes this safe is that the banner's ✕ collapses rather than
// dismisses: there is no reachable state where the app is offline and nothing
// on screen says so. A dismissible offline warning is a warning the user will
// dismiss once and then be quietly surprised by for the rest of the session.
//
// The banner comes back on NEWS and never on a clock — reconnecting, or a held
// write being rolled back. Re-expanding on a timer would train the reader to
// stop looking at it, which costs more than the row it was trying to reclaim.

import * as React from "react"

import { useConnectionState } from "@/hooks/use-connection"
import {
  bannerTimeoutMs,
  nextBannerPhase,
  type BannerEvent,
  type BannerPhase,
} from "@/lib/net/banner"
import { onMutationFailed } from "@/lib/store/mutation-queue"

export type { BannerPhase }

interface OfflineContextValue {
  offline: boolean
  phase: BannerPhase
  /** The most recent rollback, cleared when the banner is collapsed. */
  lastFailure: string | null
  /** Fold the banner into the chip. Never clears the offline condition. */
  collapse: () => void
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
}

const OfflineContext = React.createContext<OfflineContextValue | null>(null)

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const connection = useConnectionState()
  const offline = connection === "offline"

  const [phase, setPhase] = React.useState<BannerPhase>("none")
  const [lastFailure, setLastFailure] = React.useState<string | null>(null)
  const [panelOpen, setPanelOpen] = React.useState(false)

  // Every phase change goes through lib/net/banner.ts. Keeping the rules in
  // one pure function is what lets tests/net-banner.test.ts be their
  // specification rather than a paraphrase of them.
  const dispatch = React.useCallback(
    (event: BannerEvent, isOffline: boolean) => {
      setPhase((current) => nextBannerPhase(current, event, isOffline))
    },
    []
  )

  // Derived during render rather than in an effect, which is React's own
  // answer for "adjust state when an input changes": the transition is a
  // function of the connection value, and an effect would paint the stale
  // phase for a frame first and cost a second render to correct it.
  const [seen, setSeen] = React.useState(connection)
  if (seen !== connection) {
    setSeen(connection)
    if (connection === "offline") {
      dispatch({ type: "went-offline" }, true)
    } else {
      // Back online. The panel is showing offline facts that are now false, so
      // it closes itself rather than sitting there lying.
      setLastFailure(null)
      setPanelOpen(false)
      dispatch({ type: "came-online" }, false)
    }
  }

  // Auto-collapse. The whole argument for it is that entering a dead spot
  // happens several times a day, and a banner you must close turns that into a
  // repeated chore.
  React.useEffect(() => {
    const delay = bannerTimeoutMs(phase)
    if (delay === null) return
    const timer = setTimeout(
      () => dispatch({ type: "timer-elapsed" }, offline),
      delay
    )
    return () => clearTimeout(timer)
  }, [phase, offline, dispatch])

  // A scroll means the reader has moved on, so the announcement has done its
  // job early. Passive and once — this must never be a per-frame handler.
  React.useEffect(() => {
    if (phase !== "dropped") return
    const onScroll = () => dispatch({ type: "scrolled" }, offline)
    window.addEventListener("scroll", onScroll, { passive: true, once: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [phase, offline, dispatch])

  React.useEffect(
    () =>
      onMutationFailed((failure) => {
        setLastFailure(failure.label)
        setPhase((current) =>
          nextBannerPhase(current, { type: "write-failed" }, offline)
        )
      }),
    [offline]
  )

  const collapse = React.useCallback(() => {
    dispatch({ type: "user-collapsed" }, offline)
    setLastFailure(null)
  }, [dispatch, offline])

  const value = React.useMemo<OfflineContextValue>(
    () => ({ offline, phase, lastFailure, collapse, panelOpen, setPanelOpen }),
    [offline, phase, lastFailure, collapse, panelOpen]
  )

  return (
    <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
  )
}

/**
 * Returns null outside the provider rather than throwing.
 *
 * The chip is rendered from view headers that are also used in tests and in
 * isolation, and a missing offline provider should cost those a chip, not an
 * exception.
 */
export function useOffline(): OfflineContextValue | null {
  return React.useContext(OfflineContext)
}
