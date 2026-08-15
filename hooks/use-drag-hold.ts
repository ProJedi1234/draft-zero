"use client"

// hooks/use-drag-hold.ts — Is a pointer on the slider right now?
//
// The gesture is the thing a sync guard has to track, and the slider's value
// changes are a poor proxy for it at both ends. Base UI fires no change when a
// press lands on the thumb without moving it, or when a drag stays inside one
// step — so the guard would be off while a finger is down. And it fires no
// commit when a gesture is cancelled (an iOS scroll or edge swipe stealing the
// pointer), with no cancel handler of its own to fall back on — so a guard
// cleared on commit would stay latched after the finger is long gone, and the
// control would quietly stop following the server.

import * as React from "react"

const RELEASE_EVENTS = [
  "pointerup",
  "pointercancel",
  "touchend",
  "touchcancel",
] as const

/**
 * Pointer-down until release, for `useServerSyncedValue`'s `hold`. `onRelease`
 * runs when the gesture ends however it ends, including cancelled — for
 * anything else the caller froze for the duration of it.
 */
export function useDragHold(onRelease?: () => void): {
  dragging: boolean
  /** Spread onto the slider; the press bubbles up from its control. */
  dragProps: { onPointerDown: () => void }
} {
  const [dragging, setDragging] = React.useState(false)
  const onReleaseRef = React.useRef(onRelease)
  React.useEffect(() => {
    onReleaseRef.current = onRelease
  })

  React.useEffect(() => {
    if (!dragging) return
    const release = () => {
      setDragging(false)
      onReleaseRef.current?.()
    }
    // At the document, because a release routinely happens somewhere else: the
    // pointer leaves the track during the drag, and a cancel is delivered to
    // whatever captured it.
    for (const event of RELEASE_EVENTS) {
      document.addEventListener(event, release)
    }
    return () => {
      for (const event of RELEASE_EVENTS) {
        document.removeEventListener(event, release)
      }
    }
  }, [dragging])

  return { dragging, dragProps: { onPointerDown: () => setDragging(true) } }
}
