"use client"

// hooks/use-elapsed.ts — How long a run has been going, in words.
//
// Shared by the sidebar row and the library card, which show the same clock in
// two layouts. It lives here rather than in either of them because a second
// copy of a ticking clock is a second timer per story, and the useSyncExternalStore
// arrangement below is the whole reason there is only one.

import * as React from "react"

import { formatElapsed } from "@/lib/format"

/**
 * The wall clock in whole seconds, re-read once a second while `active`.
 *
 * useSyncExternalStore rather than state and an effect, for two reasons that
 * happen to have the same answer. The server has no clock worth rendering —
 * its snapshot is deliberately SENTINEL, so the HTML ships "writing" with no
 * number and the first client paint agrees with it rather than hydrating over
 * a second-old string. And re-reading the clock beats incrementing a counter:
 * a backgrounded tab throttles timers, and a counter would come back visibly
 * behind the wall clock the writer actually waited through.
 */
const SENTINEL = 0

function useSecondTick(active: boolean): number {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      if (!active) return () => {}
      const timer = setInterval(onChange, 1000)
      return () => clearInterval(timer)
    },
    [active]
  )
  return React.useSyncExternalStore(
    subscribe,
    () => (active ? Math.floor(Date.now() / 1000) : SENTINEL),
    () => SENTINEL
  )
}

/**
 * How long this story's run has been going, or null before the clock is
 * available — on the server, and for the first client paint.
 *
 * Owned by the row rather than by useRunStatus deliberately: a clock in the
 * hook would re-render every story in the library once a second to update one
 * word on one of them.
 */
export function useElapsed(startedAt: string | null): string | null {
  const seconds = useSecondTick(startedAt !== null)
  if (startedAt === null || seconds === SENTINEL) return null
  return formatElapsed(startedAt, seconds * 1000)
}
