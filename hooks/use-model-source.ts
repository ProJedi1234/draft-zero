"use client"

import * as React from "react"

/** Which half of the catalog a model picker shows. */
export type ModelSource = "all" | "local" | "external"

const STORAGE_KEY = "draft-zero:model-source"

const listeners = new Set<() => void>()
/** The choice for this page load, used when storage is blocked. */
let unstored: ModelSource = "all"

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  window.addEventListener("storage", onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener("storage", onChange)
  }
}

// Reading storage throws where the browser blocks it (Safari with site data
// blocked), so the choice then lasts only for this page load.
function readStored(): ModelSource {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === "local" || value === "external" ? value : "all"
  } catch {
    return unstored
  }
}

/**
 * The picker's Local/External filter, remembered per device and shared by
 * every picker on the page. A view preference, so it never syncs.
 */
export function useModelSource(): [ModelSource, (next: ModelSource) => void] {
  const source = React.useSyncExternalStore(
    subscribe,
    readStored,
    (): ModelSource => "all"
  )
  const setSource = React.useCallback((next: ModelSource) => {
    unstored = next
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Blocked storage: readStored falls back to `unstored`.
    }
    listeners.forEach((notify) => notify())
  }, [])
  return [source, setSource]
}
