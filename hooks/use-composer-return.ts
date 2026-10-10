"use client"

import * as React from "react"

const STORAGE_KEY = "draft-zero:mobile-return"
const CHANGE_EVENT = "draft-zero:mobile-return-changed"
const viewportHeights = new Map<number, number>()
export type MobileReturn = "send" | "newline"

function readPreference(): MobileReturn {
  try {
    return localStorage.getItem(STORAGE_KEY) === "newline" ? "newline" : "send"
  } catch {
    return "send"
  }
}

function subscribe(notify: () => void) {
  window.addEventListener("storage", notify)
  window.addEventListener(CHANGE_EVENT, notify)
  return () => {
    window.removeEventListener("storage", notify)
    window.removeEventListener(CHANGE_EVENT, notify)
  }
}

export function useMobileReturn() {
  React.useEffect(() => {
    const viewport = window.visualViewport
    const measure = () => {
      const angle = window.screen.orientation?.angle ?? 0
      if (viewport && viewport.scale <= 1) {
        viewportHeights.set(
          angle,
          Math.max(viewportHeights.get(angle) ?? 0, viewport.height)
        )
      }
    }
    measure()
    viewport?.addEventListener("resize", measure)
    return () => viewport?.removeEventListener("resize", measure)
  }, [])
  const preference = React.useSyncExternalStore(
    subscribe,
    readPreference,
    () => "send" as const
  )
  const setPreference = (value: MobileReturn) => {
    try {
      localStorage.setItem(STORAGE_KEY, value)
    } catch {
      return
    }
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }
  return [preference, setPreference] as const
}

export function softwareKeyboardOpen() {
  // iOS software Shift reports the same modifiers as hardware Shift. The
  // visible viewport can shrink along with innerHeight, so keep its full height.
  const viewport = window.visualViewport
  const fullHeight =
    viewportHeights.get(window.screen.orientation?.angle ?? 0) ??
    window.innerHeight
  return (
    document.documentElement.dataset.keyboard === "up" ||
    (navigator.maxTouchPoints > 0 &&
      !!viewport &&
      viewport.scale <= 1 &&
      fullHeight - viewport.height > 150)
  )
}

export function useSoftwareReturn(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  preference: MobileReturn,
  send: () => void,
  mounted = true
) {
  const explicitLineBreak = React.useRef(false)
  const onSend = React.useEffectEvent(send)

  React.useEffect(() => {
    const field = ref.current
    if (!field || !mounted) return
    const beforeInput = (event: InputEvent) => {
      if (
        explicitLineBreak.current ||
        event.isComposing ||
        !event.cancelable ||
        !softwareKeyboardOpen() ||
        (event.inputType !== "insertLineBreak" &&
          event.inputType !== "insertParagraph")
      )
        return
      if (preference === "newline") return
      event.preventDefault()
      if (!field.readOnly && !field.disabled) onSend()
    }
    field.addEventListener("beforeinput", beforeInput)
    return () => field.removeEventListener("beforeinput", beforeInput)
  }, [ref, preference, mounted])

  return () => {
    const field = ref.current
    if (!field || field.readOnly || field.disabled) return
    field.focus({ preventScroll: true })
    explicitLineBreak.current = true
    try {
      document.execCommand("insertText", false, "\n")
    } finally {
      explicitLineBreak.current = false
    }
  }
}

const COARSE_POINTER = "(any-pointer: coarse)"

function subscribeCoarsePointer(notify: () => void) {
  const query = window.matchMedia(COARSE_POINTER)
  query.addEventListener("change", notify)
  return () => query.removeEventListener("change", notify)
}

/** Whether this device can raise a software keyboard at all. */
export function useTouchKeyboard() {
  return React.useSyncExternalStore(
    subscribeCoarsePointer,
    () => window.matchMedia(COARSE_POINTER).matches,
    () => false
  )
}
