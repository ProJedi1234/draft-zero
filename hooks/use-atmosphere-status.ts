"use client"

// hooks/use-atmosphere-status.ts — What the atmosphere picker is doing on this
// story, for the two places that show it.
//
// The picker is the one background job whose failures are invisible by
// construction: its entire product is a colour, so "the model refused" and
// "the scene hadn't moved" and "it never ran" all look identical from the
// manuscript. This is the subscription that lets a sparkle say which it was.

import * as React from "react"

import { atmosphereStatus, type AtmosphereEvent } from "@/lib/sync/client"

/**
 * The picker's state for one story, or null before it has done anything this
 * session.
 *
 * Seeded from the singleton's memory rather than from nothing, because the
 * indicators mount late: the inspector is opened after the check that failed,
 * and a hook that only listened forward would show a clean sparkle over a
 * story that had given up.
 */
export function useAtmosphereStatus(storyId: string): AtmosphereEvent | null {
  const subscribe = React.useCallback(
    (onChange: () => void) =>
      atmosphereStatus.subscribe((next) => {
        // Every open device hears every story's events; this one only cares
        // about the story it is mounted on.
        if (next.storyId === storyId) onChange()
      }),
    [storyId]
  )

  // useSyncExternalStore rather than state-plus-effect: the snapshot is the
  // same event OBJECT the store holds, so repeated reads are reference-equal
  // and React can compare them without a cache. Nothing is rendered on the
  // server — a phase is a fact about this browser's session, not about the
  // payload — so the server snapshot is always null.
  return React.useSyncExternalStore(
    subscribe,
    () => atmosphereStatus.last.get(storyId) ?? null,
    () => null
  )
}
