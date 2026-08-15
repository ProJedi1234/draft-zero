"use client"

// hooks/use-server-synced.ts — How a mounted control follows the server without
// fighting the person using it.
//
// §4.2 says DB-backed fields are uncontrolled after mount and never resync from
// props. That rule predates magic sync, and it is the reason a model picked on
// the phone never appeared on the desktop: the `change` event arrives, the tree
// refetches, fresh props land — and a `useState(prop)` seeded at mount ignores
// every one of them. The two hooks here are the documented exception to §4.2,
// one per shape of control: `useServerSyncedField` for text living in the DOM,
// `useServerSyncedValue` for a value living in state.
//
// Both answer the same question the same way. An incoming server value is
// adopted only when this control has no write of its own in flight, because
// the props that arrive during a save are frequently older than the save —
// adopting them would roll the control backwards under the writer's hands. So
// each records what it last wrote and waits to see that exact value handed
// back before it trusts props again. `hold` extends the same courtesy to a
// gesture: a slider mid-drag is an edit in progress even though nothing has
// been written yet.
//
// The echo is an optimisation, not the contract: a save can fail, and a write
// from another device can win the row, and in neither case is our value ever
// coming back. So every caller must tell its control how the save ended —
// `settle()` or `reset()` — or the control waits forever and silently stops
// following the server, which is the one failure this file exists to prevent.

import * as React from "react"

import type { SaveStatus } from "@/hooks/use-autosave"

/**
 * A DB-backed text field that is uncontrolled after mount but still reconciles
 * when the value changes *somewhere else* — another device, the sidebar's
 * Rename dialog editing the same column as the Title field, or the mobile sheet
 * mounting a second copy of every field while the desktop panel stays mounted
 * behind it.
 *
 * The rule: an incoming server value is written into the DOM only when this
 * field has no edit of its own in flight and is not focused. `pendingRef` holds
 * the last value this field wrote and is cleared once the props echo it back, so
 * a revalidation that predates our own save can never roll the field backwards.
 *
 * Callers must record the value the *server will store*, not the keystrokes:
 * `updateStoryMeta` trims the title and turns a blank system prompt into NULL,
 * and an echo that can never match the recorded text would latch this field
 * shut for good.
 */
export function useServerSyncedField<
  E extends HTMLInputElement | HTMLTextAreaElement,
>(ref: React.RefObject<E | null>, serverValue: string, status: SaveStatus) {
  const pendingRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return

    const pending = pendingRef.current
    if (pending !== null) {
      // Our own write is still travelling; the server has caught up only when
      // it hands the same text back.
      if (serverValue === pending) {
        pendingRef.current = null
        return
      }
      // Unless it failed, in which case no echo is ever coming and waiting for
      // one would ignore the server for the life of the mount.
      if (status !== "error") return
      pendingRef.current = null
    }

    if (el === document.activeElement) return
    if (el.value === serverValue) return
    el.value = serverValue
  }, [ref, serverValue, status])

  /** Record what this field just wrote, so its own echo isn't mistaken for an external change. */
  const markWritten = React.useCallback((value: string) => {
    pendingRef.current = value
  }, [])

  /** Put the field back on the server value and forget the local edit. */
  const restore = React.useCallback(
    (value: string) => {
      pendingRef.current = null
      if (ref.current) ref.current.value = value
    },
    [ref]
  )

  return { markWritten, restore }
}

export interface ServerSyncedValue<T> {
  /** What to render. The server's value, except while this control is mid-edit. */
  value: T
  /**
   * What the row is believed to hold — the server's value, plus this device's
   * own write once it has been declared. Compare against it to decide whether a
   * save is worth making: a thumb released where it started and a picker
   * reselecting the current option both have nothing to persist.
   */
  server: T
  /**
   * Move the control without claiming anything was persisted — drag frames,
   * where the value is still changing and only the release will be saved.
   */
  setLocal: (next: T) => void
  /** Declare `next` persisted (or about to be), so its own echo isn't mistaken for a foreign change. */
  write: (next: T) => void
  /**
   * Declare the write in flight resolved successfully. The row is now whatever
   * the server says it is — our value, or a later write from another device
   * that beat ours to it — so stop holding out for an echo that may never
   * match, and let the next server value through.
   */
  settle: () => void
  /**
   * Put the control back on a value and forget the write in flight — for a
   * save that came back `{ ok: false }`, where the row never moved and waiting
   * for an echo that is never coming would freeze this control on stale props.
   */
  reset: (next: T) => void
}

export interface SyncState<T> {
  value: T
  server: T
  /**
   * Our own write, awaiting its echo. Boxed because `null` is a real value here
   * (a null providerTag means Auto) and could not otherwise be told apart from
   * "nothing in flight".
   */
  pending: { value: T } | null
}

/**
 * Fold a fresh server value into the state. Pure — it runs during render, and
 * it is where every rule about whose value wins lives, which is why it is
 * exported: tests/server-synced.test.ts is its specification.
 */
export function adopt<T>(
  state: SyncState<T>,
  serverValue: T,
  hold: boolean
): SyncState<T> {
  let pending = state.pending
  if (pending !== null) {
    // Still travelling. Only our own value coming back proves the server has
    // caught up; anything else is a prop older than our write.
    if (!Object.is(serverValue, pending.value)) return state
    pending = null
  }
  // `server` moves even while held, so a release that lands back on the value
  // from before the gesture is still recognised as a change worth saving.
  const value = hold ? state.value : serverValue
  if (
    pending === state.pending &&
    Object.is(value, state.value) &&
    Object.is(serverValue, state.server)
  ) {
    return state
  }
  return { value, server: serverValue, pending }
}

/** Declare `next` persisted (or about to be). Pure; see `write` below. */
export function writeValue<T>(state: SyncState<T>, next: T): SyncState<T> {
  return Object.is(next, state.server)
    ? // Nothing to echo, so nothing to wait for; just move the control.
      { ...state, value: next }
    : { value: next, server: next, pending: { value: next } }
}

/** Give up on the echo, keeping the value. Pure; see `settle` below. */
export function settleValue<T>(state: SyncState<T>): SyncState<T> {
  return state.pending === null ? state : { ...state, pending: null }
}

/**
 * The value-shaped sibling of `useServerSyncedField`, for controls whose state
 * is a value rather than DOM text: comboboxes, selects, sliders.
 *
 * `hold` is the gesture equivalent of that hook's focus check — pass `true`
 * while a drag is in progress and an incoming value waits until the thumb is
 * let go. Waits, not discarded: a change of `hold` re-runs the adoption, so the
 * value that arrived mid-drag lands the moment the gesture ends, unless the
 * release itself wrote something (a write beats an adoption, having happened
 * later).
 *
 * Reconciled during render rather than from an effect — this is React's
 * adjusting-state-when-a-prop-changes pattern, and doing it in an effect would
 * paint the stale value for a frame first.
 */
export function useServerSyncedValue<T>(
  serverValue: T,
  { hold = false }: { hold?: boolean } = {}
): ServerSyncedValue<T> {
  const [state, setState] = React.useState<SyncState<T>>(() => ({
    value: serverValue,
    server: serverValue,
    pending: null,
  }))
  // Bumped whenever a write resolves. A server value `adopt` turned away while
  // that write was travelling still advances `seen`, so without a nudge the
  // comparison below would never reconsider it and the control would sit on a
  // value the row does not hold — permanently, since the props need not change
  // again. The epoch is what forces exactly one more reconciliation.
  const [epoch, setEpoch] = React.useState(0)
  // The props the current state was reconciled against. Comparing them is what
  // makes the adjustment below run once per change instead of every render.
  const [seen, setSeen] = React.useState({ serverValue, hold, epoch })

  let current = state
  if (
    !Object.is(seen.serverValue, serverValue) ||
    seen.hold !== hold ||
    seen.epoch !== epoch
  ) {
    current = adopt(state, serverValue, hold)
    setSeen({ serverValue, hold, epoch })
    if (current !== state) setState(current)
  }

  const setLocal = React.useCallback(
    (next: T) => setState((s) => ({ ...s, value: next })),
    []
  )

  const write = React.useCallback((next: T) => {
    setState((s) => writeValue(s, next))
  }, [])

  // Both of these end the wait for an echo, so both have to re-arm adoption:
  // the value that arrived while the write was in flight is the one most likely
  // to have been turned away, and it is the one nothing else will offer again.
  const settle = React.useCallback(() => {
    setState(settleValue)
    setEpoch((e) => e + 1)
  }, [])

  const reset = React.useCallback((next: T) => {
    setState({ value: next, server: next, pending: null })
    setEpoch((e) => e + 1)
  }, [])

  return {
    value: current.value,
    server: current.server,
    setLocal,
    write,
    settle,
    reset,
  }
}
