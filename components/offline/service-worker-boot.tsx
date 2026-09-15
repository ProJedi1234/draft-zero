"use client"

// components/offline/service-worker-boot.tsx — Registers public/sw.js and
// starts the connection machine. Renders nothing.
//
// Separate from StoreBoot because the two answer different questions and fail
// independently: StoreBoot is about what data this device already has, this is
// about whether the app can be opened at all next time. A thrown registration
// must not cost the store its cold start.

import * as React from "react"

import { startConnectionWatch } from "@/lib/net/connection"
import { hydrateForcedOffline, isForcedOffline } from "@/lib/net/debug"

export function ServiceWorkerBoot(): null {
  React.useEffect(() => {
    // Order matters: the debug flag has to be read before the connection
    // machine starts, or the machine's first reading would be "online" and it
    // would flip a moment later.
    hydrateForcedOffline()
    startConnectionWatch()

    if (!("serviceWorker" in navigator)) return

    // Dev has no service worker on purpose. It sits in front of HMR and the
    // dev server's chunk URLs are not content-hashed, so a cached document
    // reliably desyncs from the chunks it wants and the page white-screens.
    if (process.env.NODE_ENV !== "production") {
      // A worker left over from a production build on the same origin (the
      // demo stack and `next dev` share localhost more often than not) would
      // keep doing all of that, so clear it rather than merely not adding one.
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          for (const registration of registrations)
            void registration.unregister()
        })
        .catch(() => {
          // Nothing to clean up, or storage is unavailable. Either is fine.
        })
      return
    }

    void navigator.serviceWorker
      .register("/sw.js", {
        scope: "/",
        // Without this the browser may answer the worker's own update check
        // from the HTTP cache, which can pin a deployment to a stale worker
        // for as long as that entry lives.
        updateViaCache: "none",
      })
      .then((registration) => {
        // A worker that starts after the page asserts nothing, so re-assert
        // the debug flag once it is controlling us. See lib/net/debug.ts for
        // why the worker does not remember it itself.
        if (isForcedOffline()) {
          registration.active?.postMessage({
            type: "dz-force-offline",
            value: true,
          })
        }
      })
      .catch(() => {
        // An unregistrable worker is a degraded install, not a broken app:
        // everything still works online, and offline goes back to what it was
        // before this feature existed. Nothing to say to the user about it.
      })
  }, [])

  return null
}

export default ServiceWorkerBoot
