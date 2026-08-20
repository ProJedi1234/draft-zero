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
// adopting them would roll the control backwards under the writer's hands.
// `hold` extends the same courtesy to a gesture: a slider mid-drag is an edit
// in progress even though nothing has been written yet.
//
// Which props are "older" is not a question a control can answer by looking at
// the value. An earlier version of this file tried: it recorded what it wrote
// and waited to see that exact value handed back. That works right up until the
// moment it matters — a server action resolves before the tree it revalidated
// has been applied, so the props on hand at that moment are still the ones from
// before the write, and every rule phrased in terms of value equality read them
// as news. The model picker showed the new model, dropped back to the old one,
// and returned when the payload finally landed.
//
// So the arbitration is by row version instead. `version` is the row's
// `updated_at`, bumped by every write and monotonic across devices, and it
// makes staleness decidable rather than guessable: a payload no newer than the
// one already on display is a render that was in flight when the row moved, and
// is ignored no matter what it says. Callers with no version to give (the
// settings page's defaults live in a row that has no `updated_at`) fall back to
// following a change of the value itself, which is what this file did before.
//
// The other half is that a local write suspends adoption until it resolves —
// counted, because the writer can get ahead of the network and two switches can
// be travelling at once. So every caller must tell its control how the save
// ended, `settle()` or `reset()`, or the count never returns to zero and the
// control silently stops following the server, which is the one failure this
// file exists to prevent.

import * as React from "react"

import type { SaveStatus } from "@/hooks/use-autosave"

/**
 * A DB-backed text field that is uncontrolled after mount but still reconciles
 * when the value changes *somewhere else* — another device, or the mobile sheet
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
   * Declare the write in flight resolved successfully — the row moved, and the
   * payload carrying it is on its way. One call per `write`, or the control
   * never resumes following the server.
   */
  settle: () => void
  /**
   * Put the control back on a value and end the write — for a save that came
   * back `{ ok: false }`, where the row never moved and leaving the write
   * counted would freeze this control for the life of the mount.
   */
  reset: (next: T) => void
}

export interface SyncState<T> {
  value: T
  server: T
  /**
   * Local writes dispatched and not yet resolved. Following the server is
   * suspended while this is above zero: our own value is the newest thing
   * anyone knows about until the save says otherwise.
   *
   * Counted rather than a flag because the writer can outrun the network —
   * two model switches in a second are two writes in flight, and the first
   * one resolving must not hand the control back to props that predate the
   * second.
   */
  inFlight: number
  /**
   * The row version the displayed server value came from — `updated_at`, as an
   * ISO-8601 UTC string, so string order is chronological order. Null when the
   * caller has no version to give, which drops the arbitration back to
   * following a change of the value itself.
   */
  version: string | null
}

/**
 * Fold a fresh server value into the state. Pure — it runs during render, and
 * it is where every rule about whose value wins lives, which is why it is
 * exported: tests/server-synced.test.ts is its specification.
 */
export function adopt<T>(
  state: SyncState<T>,
  serverValue: T,
  version: string | null,
  hold: boolean
): SyncState<T> {
  // Our own write outranks anything the server can say until it resolves. This
  // is what stops a payload rendered before the write from undoing it, and what
  // keeps the first of two rapid switches from overwriting the second.
  if (state.inFlight > 0) return state
  // A payload no newer than the one on display was already in flight when the
  // row moved. It is not news whatever it says, and taking it is exactly the
  // backwards jump this file exists to prevent.
  if (version !== null && state.version !== null && version <= state.version) {
    return state
  }
  if (hold) {
    // The row is tracked through a gesture so a release that lands back on the
    // value from before it still counts as a change worth saving. The version
    // deliberately is NOT taken: the value is still owed to the control, and
    // taking it here would mean the release had nothing left to adopt.
    return Object.is(serverValue, state.server)
      ? state
      : { ...state, server: serverValue }
  }
  if (
    Object.is(serverValue, state.value) &&
    Object.is(serverValue, state.server) &&
    version === state.version
  ) {
    return state
  }
  return { value: serverValue, server: serverValue, inFlight: 0, version }
}

/**
 * Declare `next` persisted (or about to be). Pure; see `write` below.
 *
 * A write onto the value the row already holds is not a save and gets no
 * count: callers commit unconditionally and decide afterwards whether anything
 * changed (a thumb released where it started), and counting that one would
 * leave a write outstanding that no `settle` is ever coming for.
 */
export function writeValue<T>(state: SyncState<T>, next: T): SyncState<T> {
  return Object.is(next, state.server)
    ? { ...state, value: next }
    : { ...state, value: next, server: next, inFlight: state.inFlight + 1 }
}

/** End one write, keeping the value. Pure; see `settle` below. */
export function settleValue<T>(state: SyncState<T>): SyncState<T> {
  // Clamped rather than trusted: an unbalanced settle is a caller bug, and
  // going negative would suspend this control forever, which is the worse of
  // the two failures by a wide margin.
  return state.inFlight === 0
    ? state
    : { ...state, inFlight: state.inFlight - 1 }
}

/** End one write and put the value back. Pure; see `reset` below. */
export function resetValue<T>(state: SyncState<T>, next: T): SyncState<T> {
  return {
    ...settleValue(state),
    value: next,
    server: next,
  }
}

/**
 * Whether the reconciliation is owed another run. Purely a question about what
 * has moved since the last one — `adopt` is what decides the outcome, and the
 * two must not both hold opinions or they disagree.
 *
 * The `inFlight` term is the one worth explaining. A payload that arrives while
 * a local write is travelling is refused by `adopt` and, crucially, does not
 * advance the version — so nothing would ever offer it again, and a control
 * that lost a race to another device would sit on a value the row does not hold
 * for the life of the mount. Running once more as the last write resolves is
 * what finds it, and the version test in `adopt` is what makes running then
 * safe: a payload older than the row we are displaying is turned away rather
 * than mistaken for the news this run went looking for.
 *
 * A caller with no version has no such protection, so it does not get the extra
 * run — a stale payload and a fresh one are indistinguishable to it, and the
 * cure would be worse than the rare disease.
 */
export function isNews<T>(
  seen: {
    serverValue: T
    hold: boolean
    version: string | null
    inFlight: number
  },
  state: SyncState<T>,
  serverValue: T,
  version: string | null,
  hold: boolean
): boolean {
  if (seen.hold !== hold) return true
  if (!Object.is(seen.serverValue, serverValue)) return true
  if (seen.version !== version) return true
  return version !== null && seen.inFlight !== state.inFlight
}

export function useServerSyncedValue<T>(
  serverValue: T,
  {
    hold = false,
    version = null,
  }: { hold?: boolean; version?: string | null } = {}
): ServerSyncedValue<T> {
  const [state, setState] = React.useState<SyncState<T>>(() => ({
    value: serverValue,
    server: serverValue,
    inFlight: 0,
    version,
  }))
  // What the current state was last reconciled against. Comparing it is what
  // makes the adjustment below run once per change instead of every render,
  // which is not an optimisation: `setSeen` allocates, so a gate that stayed
  // open would re-render forever.
  const [seen, setSeen] = React.useState({
    serverValue,
    hold,
    version,
    inFlight: 0,
  })

  let current = state
  if (isNews(seen, state, serverValue, version, hold)) {
    current = adopt(state, serverValue, version, hold)
    setSeen({ serverValue, hold, version, inFlight: state.inFlight })
    if (current !== state) setState(current)
  }

  const setLocal = React.useCallback(
    (next: T) => setState((s) => ({ ...s, value: next })),
    []
  )

  const write = React.useCallback((next: T) => {
    setState((s) => writeValue(s, next))
  }, [])

  // Neither of these adopts anything. They end one write, and the state that
  // leaves — a count back at zero, against a version that has not moved — is
  // what lets the reconciliation above take the payload when it lands, and
  // ignore everything that was already in flight before the row moved.
  const settle = React.useCallback(() => {
    setState(settleValue)
  }, [])

  const reset = React.useCallback((next: T) => {
    setState((s) => resetValue(s, next))
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
