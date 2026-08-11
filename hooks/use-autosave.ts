"use client"

// hooks/use-autosave.ts — Shared debounced autosave + the global save-status store.
// Text fields call schedule() on change and flush() on blur; discrete controls
// (selects, switches, slider commits) save immediately via useTransition instead.
// Every instance reports into one module-level store so the story header's
// "Saved locally" chip reflects saves happening anywhere in the app.

import * as React from "react"
import { toast } from "sonner"

import type { ActionResult } from "@/lib/types"

export type SaveStatus = "idle" | "saving" | "saved" | "error"

const DEFAULT_DELAY_MS = 600
const FALLBACK_ERROR = "Couldn't save your changes."

// ---------------------------------------------------------------------------
// Global save store (module state + useSyncExternalStore)
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>()
let inFlight = 0
let lastSaveFailed = false
let hasSavedOnce = false
let snapshot: SaveStatus = "idle"

function computeStatus(): SaveStatus {
  if (inFlight > 0) return "saving"
  if (lastSaveFailed) return "error"
  return hasSavedOnce ? "saved" : "idle"
}

function publish() {
  const next = computeStatus()
  if (next === snapshot) return
  snapshot = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): SaveStatus {
  return snapshot
}

/** The server never has a save in flight. */
function getServerSnapshot(): SaveStatus {
  return "idle"
}

function beginGlobalSave() {
  inFlight += 1
  publish()
}

function endGlobalSave(ok: boolean) {
  inFlight = Math.max(0, inFlight - 1)
  lastSaveFailed = !ok
  if (ok) hasSavedOnce = true
  publish()
}

/** Global aggregate: "saving" if any autosave is in flight, "error" if the latest finished save failed, else "saved"/"idle". */
export function useSaveStatus(): SaveStatus {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

// ---------------------------------------------------------------------------
// useAutosave
// ---------------------------------------------------------------------------

/**
 * Debounced autosave. schedule() debounces (600 ms by default); flush() saves the
 * pending value immediately (call it on blur); cancel() discards whatever is
 * pending (call it when the current value must not be persisted). Latest wins: a
 * newer schedule supersedes an in-flight debounce and stale completions never
 * touch the status. Failures toast and set status "error".
 */
export function useAutosave<T>(
  save: (value: T) => Promise<ActionResult<unknown>>,
  delayMs: number = DEFAULT_DELAY_MS
): {
  schedule: (value: T) => void
  flush: () => void
  cancel: () => void
  status: SaveStatus
} {
  const [status, setStatus] = React.useState<SaveStatus>("idle")

  const saveRef = React.useRef(save)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = React.useRef<{ value: T } | null>(null)
  const runIdRef = React.useRef(0)
  const mountedRef = React.useRef(true)

  React.useEffect(() => {
    saveRef.current = save
  })

  const run = React.useCallback((value: T) => {
    const runId = runIdRef.current + 1
    runIdRef.current = runId
    pendingRef.current = null

    if (mountedRef.current) setStatus("saving")
    beginGlobalSave()

    void (async () => {
      let ok = false
      let message = FALLBACK_ERROR
      try {
        const result = await saveRef.current(value)
        ok = result.ok
        if (!result.ok) message = result.error
      } catch (error) {
        ok = false
        message =
          error instanceof Error && error.message
            ? error.message
            : FALLBACK_ERROR
      }

      endGlobalSave(ok)
      if (!ok) toast.error(message)
      // A newer save superseded this one — its result is the truth.
      if (runId !== runIdRef.current) return
      if (mountedRef.current) setStatus(ok ? "saved" : "error")
    })()
  }, [])

  const schedule = React.useCallback(
    (value: T) => {
      pendingRef.current = { value }
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        const pending = pendingRef.current
        if (pending === null) return
        run(pending.value)
      }, delayMs)
    },
    [delayMs, run]
  )

  const flush = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const pending = pendingRef.current
    if (pending === null) return
    run(pending.value)
  }, [run])

  /**
   * Drop the pending value without saving it. Used when the field reaches a
   * state that must never be persisted (e.g. a cleared required field) — the
   * older debounced value would otherwise be written by flush() or by the
   * unmount flush below.
   */
  const cancel = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    pendingRef.current = null
  }, [])

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      // Don't lose an edit to navigation: fire the pending save on the way out.
      const pending = pendingRef.current
      if (pending !== null) run(pending.value)
    }
  }, [run])

  return { schedule, flush, cancel, status }
}
