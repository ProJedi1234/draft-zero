"use client"

// hooks/use-connection.ts — React's view of lib/net/connection.ts.
//
// useSyncExternalStore for the same reason hooks/use-store.ts uses it: the
// machine is a module singleton driven by window events, a probe timer and the
// debug flag, none of which is inside a React tree. The server snapshot is
// always "online" so SSR and the first client render agree — a server has no
// opinion about a browser's radio, and rendering the offline chrome into the
// HTML would flash it on every cold load.

import * as React from "react"

import {
  getConnectionState,
  subscribeConnection,
  type ConnectionState,
} from "@/lib/net/connection"
import {
  isForcedOffline,
  setForcedOffline,
  subscribeForcedOffline,
} from "@/lib/net/debug"

function serverState(): ConnectionState {
  return "online"
}

export function useConnectionState(): ConnectionState {
  return React.useSyncExternalStore(
    subscribeConnection,
    getConnectionState,
    serverState
  )
}

export function useIsOffline(): boolean {
  return useConnectionState() === "offline"
}

/** The Developer settings switch. Reads and writes the same flag the SW sees. */
export function useForcedOffline(): [boolean, (value: boolean) => void] {
  const forced = React.useSyncExternalStore(
    subscribeForcedOffline,
    isForcedOffline,
    returnFalse
  )
  return [forced, setForcedOffline]
}

function returnFalse(): boolean {
  return false
}
