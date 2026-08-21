"use client"

// hooks/use-story-sync.ts — The device's ear on /api/sync/events.
//
// One connection per device, held by a root-layout client component
// (components/sync-listener.tsx) rather than by the story workspace: `change`
// events are what keep the library list, the lorebook and the settings pages
// honest too, and a channel mounted inside the workspace goes silent on
// exactly the pages that show that data. It carries no data, only facts:
// `change` means "the database moved" and is answered with router.refresh() —
// with force-dynamic RSC the refetch IS the sync — and `run-started` means
// another device began generating, which hands off through the runHandoff
// singleton to whatever story workspace is mounted, so that device attaches
// and mirrors the stream mid-flight.
//
// The connection is expected to die: iOS kills a background PWA's sockets
// without ceremony, dev HMR restarts the server, wifi blips. Every exit from
// the read loop lands in the same reconnect path — backoff 1s/2s/5s — and a
// visibilitychange→visible or `online` event short-circuits the backoff,
// because those are the moments a socket is most likely to be dead and the
// writer most likely to be looking. Each successful REconnect refreshes once:
// any change events emitted while the socket was down are gone for good, and
// one refetch is exactly what they would have amounted to.
//
// A hidden tab holds no socket at all. Every tab keeping one permanently is
// what exhausts the browser's 6-per-origin HTTP/1.1 pool on a plain-HTTP LAN
// origin — half a dozen backgrounded tabs and every request in every tab
// silently hangs. visibilitychange→visible was already the recovery path, so
// going dark on hidden costs nothing but the refresh a reconnect does anyway.

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  localRefresh,
  openSyncChannel,
  runEndings,
  runHandoff,
} from "@/lib/sync/client"

/** Collapses a burst of change events (multi-row write) into one refetch. */
const REFRESH_DEBOUNCE_MS = 150

const RECONNECT_BACKOFF_MS = [1000, 2000, 5000]

export function useStorySync(): void {
  const router = useRouter()

  React.useEffect(() => {
    let disposed = false
    let controller: AbortController | null = null
    let attempt = 0
    let everConnected = false
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleRefresh = () => {
      if (refreshTimer !== null) return
      const fire = () => {
        refreshTimer = null
        // A server-action transition on this device is already revalidating.
        // Deferred, not dropped: the event may be a FOREIGN write committing
        // during the local transition, whose rows that revalidation can have
        // missed — so check again once the transition drains, and refresh
        // then. The echo of a purely local write costs one extra refetch of
        // an unchanged tree; a swallowed foreign write costs a device that
        // stays stale for good.
        if (localRefresh.pending > 0) {
          refreshTimer = setTimeout(fire, REFRESH_DEBOUNCE_MS)
          return
        }
        router.refresh()
      }
      refreshTimer = setTimeout(fire, REFRESH_DEBOUNCE_MS)
    }

    const connect = async () => {
      if (disposed || document.visibilityState === "hidden") return
      controller?.abort()
      const own = new AbortController()
      controller = own

      try {
        const events = await openSyncChannel(own.signal)
        for await (const event of events) {
          if (own.signal.aborted) return

          if (event.type === "hello") {
            // Connected. On a REconnect, events emitted while the socket was
            // down are unrecoverable — one refresh is their sum, and the run
            // probe recovers any run-started that fell in the gap.
            if (everConnected) {
              router.refresh()
              runHandoff.current?.onReconnect()
            }
            everConnected = true
            attempt = 0
            continue
          }
          if (event.type === "change") {
            scheduleRefresh()
            continue
          }
          if (event.type === "run-started") {
            const target = runHandoff.current
            if (target !== null && event.storyId === target.storyId)
              target.onRunStarted(event.runId)
            // ...and the library needs it too, whichever story is open. The
            // sidebar's status marks come from the registry, which is read
            // during the root layout's render — so without a refetch here the
            // list of runs in flight is whatever it was when the page last
            // rendered, and a story that started generating never says so. No
            // `change` covers this: a run start persists nothing, and
            // touchStory does not fire until the run ENDS.
            scheduleRefresh()
            continue
          }
          if (event.type === "run-ended") {
            // Not routed to the open story the way run-started is: this exists
            // for the rows nobody is looking at, and the library decides which
            // of them it is news for.
            runEndings.publish(event)
          }
          // Pings need no handling — arriving is their whole content; the
          // stall guard in the reader is what notices their absence.
        }
      } catch {
        // Fall through to the reconnect below; an abort exits above.
      }
      if (disposed || own.signal.aborted) return

      const backoff =
        RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)]
      attempt += 1
      retryTimer = setTimeout(() => void connect(), backoff)
    }

    // Waking up and coming back online are the moments the socket is most
    // likely dead AND the writer is looking — reconnect now, not on backoff.
    const reconnectNow = () => {
      if (disposed) return
      if (retryTimer !== null) clearTimeout(retryTimer)
      retryTimer = null
      attempt = 0
      void connect()
    }
    // Hiding gives the socket back to the pool (see the header comment); the
    // reconnect on visible refreshes once, which covers whatever was missed.
    const suspend = () => {
      if (retryTimer !== null) clearTimeout(retryTimer)
      retryTimer = null
      controller?.abort()
      controller = null
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") reconnectNow()
      else suspend()
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("online", reconnectNow)
    void connect()

    return () => {
      disposed = true
      controller?.abort()
      if (refreshTimer !== null) clearTimeout(refreshTimer)
      if (retryTimer !== null) clearTimeout(retryTimer)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("online", reconnectNow)
    }
  }, [router])
}
