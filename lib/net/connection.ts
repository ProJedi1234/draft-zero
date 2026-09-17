// lib/net/connection.ts — One answer to "can we reach the server", for every
// part of the UI that needs to stop promising things.
//
// A module singleton with subscribers, like lib/sync/bus.ts and the mutation
// queue, so a component reads it through a hook and nothing has to thread it
// down a tree.
//
// Two states and no more, on purpose. Grading a connection into slow/unstable
// rungs is a real improvement and a real state machine, and one that
// oscillates is worse than none — so the graded version waits until the plain
// one is known to be right. See the design notes for the four-rung ladder that
// is deliberately not here.
//
// The signals, in the order they are trusted:
//
//   Forced offline    the debug flag. Absolute; nothing overrides it.
//   navigator.onLine  false is proof. TRUE IS NOT: iOS reports online on a
//                     captive portal and on a Wi-Fi network with no route out,
//                     which is exactly the case that produces the dead page.
//   The probe         GET /api/health. This is the only positive evidence
//                     there is, so going back online always requires one.
//
// Hysteresis is asymmetric and that is deliberate. One failed request does not
// declare offline — it only triggers a probe, because a single request can
// fail for its own reasons. One successful probe does declare online, because
// a reply from our own server is not ambiguous.

import { isForcedOffline, subscribeForcedOffline } from "@/lib/net/debug"

export type ConnectionState = "online" | "offline"

/**
 * Why a probe failed, kept apart because the three mean genuinely different
 * things to a person: nothing answered, something answered too slowly, or the
 * server answered that it is broken. The connection test shows this verbatim.
 */
export type ProbeResult =
  | { ok: true; latencyMs: number }
  | { ok: false; reason: "forced" }
  | { ok: false; reason: "unreachable" }
  | { ok: false; reason: "timeout" }
  | { ok: false; reason: "server-error"; status: number }

const PROBE_PATH = "/api/health"
const PROBE_TIMEOUT_MS = 5_000

/**
 * How long to wait before re-probing while offline, by consecutive failure.
 * Climbs so a long tunnel is not a radio-on-full battery drain, and stops at
 * 30s so a returning network is noticed within half a minute without the user
 * doing anything. The `online` event usually beats the ladder to it; the
 * ladder is what covers the case where that event never fires.
 */
const RECOVERY_LADDER_MS = [2_000, 5_000, 10_000, 20_000, 30_000]

type Listener = (state: ConnectionState) => void

const listeners = new Set<Listener>()

let state: ConnectionState = "online"
let watching = false
let consecutiveFailures = 0
let recoveryTimer: ReturnType<typeof setTimeout> | null = null
let inFlight: Promise<ProbeResult> | null = null

export function getConnectionState(): ConnectionState {
  return state
}

export function subscribeConnection(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setState(next: ConnectionState): void {
  if (state === next) return
  state = next
  for (const listener of listeners) listener(next)
}

/**
 * Tell the machine a request just failed at the transport layer — a thrown
 * fetch, not an HTTP error status. A 500 means the server is answering.
 *
 * This only schedules a probe. Declaring offline on one caller's failure would
 * let a single cancelled request take the whole UI down.
 */
export function reportRequestFailure(): void {
  if (state === "offline") return
  void probeConnection()
}

/**
 * Tell the machine a request just succeeded. Cheap enough to call from every
 * response path, and it is how the app usually notices it is back — a
 * successful write beats the recovery ladder to the answer most of the time.
 */
export function reportRequestSuccess(): void {
  if (state === "online" || isForcedOffline()) return
  consecutiveFailures = 0
  clearRecoveryTimer()
  setState("online")
}

/**
 * Ask the server directly. Shared by the state machine and by the connection
 * test in the offline panel, so the row a user reads is the same evidence the
 * app acted on rather than a second opinion.
 *
 * Concurrent callers share one request: the panel's Test button pressed while
 * the recovery ladder is mid-probe should not open a second connection.
 */
export function probeConnection(): Promise<ProbeResult> {
  if (inFlight !== null) return inFlight

  inFlight = runProbe().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function runProbe(): Promise<ProbeResult> {
  const result = await rawProbe()

  if (!result.ok) {
    consecutiveFailures += 1
    setState("offline")
    scheduleRecovery()
    return result
  }

  // isForcedOffline() is re-checked here rather than trusted from the start
  // of rawProbe(): the fetch it just awaited can take up to
  // PROBE_TIMEOUT_MS, and the debug flag can flip to true while it was in
  // flight. Without this, a probe that started before the flag changed can
  // land after it and call setState("online") — silently undoing the
  // offline state the flag's own subscriber in startConnectionWatch() just
  // set. reportRequestSuccess() already carries this guard; this is the
  // other path to the same setState("online") call, and both need it.
  //
  // The result itself still reports ok: true — the network genuinely
  // answered, and that fact is not what the flag overrides. What it
  // overrides is whether the STATE MACHINE acts on it.
  if (!isForcedOffline()) {
    consecutiveFailures = 0
    clearRecoveryTimer()
    setState("online")
  }

  return result
}

async function rawProbe(): Promise<ProbeResult> {
  if (isForcedOffline()) return { ok: false, reason: "forced" }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, reason: "unreachable" }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  const started = Date.now()

  try {
    const response = await fetch(PROBE_PATH, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      // Same-origin and credential-free: the probe must not be the thing that
      // refreshes a session, or "are we online" would have side effects.
      credentials: "omit",
    })

    if (!response.ok) {
      return { ok: false, reason: "server-error", status: response.status }
    }
    return { ok: true, latencyMs: Date.now() - started }
  } catch {
    // AbortError and TypeError arrive the same way. The timer tells them apart,
    // and the distinction is worth keeping: nothing answered is a network
    // problem, too slow is usually a middlebox swallowing the connection.
    return controller.signal.aborted
      ? { ok: false, reason: "timeout" }
      : { ok: false, reason: "unreachable" }
  } finally {
    clearTimeout(timer)
  }
}

function clearRecoveryTimer(): void {
  if (recoveryTimer === null) return
  clearTimeout(recoveryTimer)
  recoveryTimer = null
}

function scheduleRecovery(): void {
  clearRecoveryTimer()
  if (isForcedOffline()) return

  const index = Math.min(consecutiveFailures - 1, RECOVERY_LADDER_MS.length - 1)
  const delay = RECOVERY_LADDER_MS[Math.max(index, 0)]
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null
    void probeConnection()
  }, delay)
}

/**
 * Start listening. Idempotent; call it once from the client boot.
 *
 * The `online` event is treated as a hint to re-probe rather than as the
 * answer, for the captive-portal reason in the header. The `offline` event, by
 * contrast, is taken at face value — the OS saying the interface is down is
 * not something to second-guess with a request that cannot succeed.
 */
export function startConnectionWatch(): void {
  if (typeof window === "undefined" || watching) return
  watching = true

  if (isForcedOffline()) {
    setState("offline")
  } else if (navigator.onLine === false) {
    setState("offline")
    scheduleRecovery()
  }

  window.addEventListener("online", () => {
    consecutiveFailures = 0
    void probeConnection()
  })

  window.addEventListener("offline", () => {
    clearRecoveryTimer()
    setState("offline")
    consecutiveFailures = 1
    scheduleRecovery()
  })

  // Coming back to a suspended tab: the events above may have fired while the
  // page was frozen, or not fired at all. Re-check on the way in.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return
    if (state === "offline") void probeConnection()
  })

  subscribeForcedOffline((value) => {
    if (value) {
      clearRecoveryTimer()
      setState("offline")
    } else {
      consecutiveFailures = 0
      void probeConnection()
    }
  })
}

/** Test seam — the machine is a module singleton. */
export function resetConnectionForTests(): void {
  clearRecoveryTimer()
  listeners.clear()
  state = "online"
  watching = false
  consecutiveFailures = 0
  inFlight = null
}
