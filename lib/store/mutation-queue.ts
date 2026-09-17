// lib/store/mutation-queue.ts — Optimistic writes: one serial queue, one
// overlay, no inverse patches.
//
// The model is confirmed-plus-overlay rather than apply-then-undo. Enqueueing
// makes a change visible synchronously; rollback is dropping the entry, so a
// foreign write that landed underneath the overlay while the mutation was in
// flight survives a rollback untouched. Confirming folds the action's own
// returned rows into confirmed — idempotent with the bus echo of the same
// write, because both go through the store's event rule.

import {
  getConnectionState,
  reportRequestFailure,
  reportRequestSuccess,
  subscribeConnection,
} from "@/lib/net/connection"
import { clientStore } from "@/lib/store/store"
import type { EntityKind, EntityRecordMap } from "@/lib/store/records"
import { localRefresh } from "@/lib/sync/client"

/**
 * The three patch shapes, for one table. Written generically so a table joining
 * the store is a line in StorePatch below rather than three more branches —
 * and so a patch can never name one entity while carrying another's row.
 */
type PatchFor<K extends EntityKind> =
  | { entity: K; op: "upsert"; row: EntityRecordMap[K] }
  | {
      entity: K
      op: "merge"
      id: string
      /** Never includes the version field — the client does not mint versions. */
      fields: Partial<EntityRecordMap[K]>
    }
  | { entity: K; op: "delete"; id: string }

/** One queue serves every table; the readers filter by `entity`. */
export type StorePatch = PatchFor<"story"> | PatchFor<"lorebook-entry">

export interface QueuedMutation {
  id: string
  /** Human-readable, for the queue-depth indicator and debugging. */
  label: string
  patches: StorePatch[]
  run(): Promise<MutationOutcome>
}

export type MutationOutcome =
  { ok: true; canonical: CanonicalRow[] } | { ok: false; error: string }

export interface CanonicalRow {
  entity: EntityKind
  op: "upsert" | "delete"
  id: string
  version: string
  row?: unknown
}

/**
 * Attempts spent against a server that is ANSWERING. An offline park costs
 * nothing from this budget — see attempt().
 */
const MAX_ATTEMPTS = 3

const DEFAULT_BACKOFF_MS = [1000, 2000, 5000]

const DEPENDENCY_FAILED = "A change this depended on failed."

interface QueueConfig {
  backoffMs: number[]
  isOffline(): boolean
  /** Resolves when the connection machine says we are back. Never times out. */
  waitForOnline(): Promise<void>
}

function defaultIsOffline(): boolean {
  return getConnectionState() === "offline"
}

function defaultWaitForOnline(): Promise<void> {
  if (getConnectionState() === "online") return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = subscribeConnection((state) => {
      if (state !== "online") return
      unsubscribe()
      resolve()
    })
  })
}

const config: QueueConfig = {
  backoffMs: [...DEFAULT_BACKOFF_MS],
  isOffline: defaultIsOffline,
  waitForOnline: defaultWaitForOnline,
}

/** Test seam: shorten the ladder, or fake the offline signal. */
export function configureMutationQueue(patch: Partial<QueueConfig>): void {
  Object.assign(config, patch)
}

export function resetMutationQueueConfig(): void {
  config.backoffMs = [...DEFAULT_BACKOFF_MS]
  config.isOffline = defaultIsOffline
  config.waitForOnline = defaultWaitForOnline
}

interface QueueEntry {
  mutation: QueuedMutation
  resolve: (outcome: MutationOutcome) => void
}

const queue: QueueEntry[] = []
let draining = false

/**
 * A held write that was rolled back, announced so the offline banner can
 * re-expand and say so.
 *
 * The overlay disappearing is the user's work disappearing, and while offline
 * the only rule for re-expanding the banner is that the facts changed — this
 * is that fact. A listener set rather than a toast because the banner is the
 * surface that owns the offline story; a toast on top of it would say the same
 * thing twice.
 */
export type MutationFailure = { id: string; label: string; error: string }

const failureListeners = new Set<(failure: MutationFailure) => void>()

export function onMutationFailed(
  listener: (failure: MutationFailure) => void
): () => void {
  failureListeners.add(listener)
  return () => {
    failureListeners.delete(listener)
  }
}

function announceFailure(mutation: QueuedMutation, error: string): void {
  const failure: MutationFailure = {
    id: mutation.id,
    label: mutation.label,
    error,
  }
  for (const listener of failureListeners) listener(failure)
}

export const mutationQueue = {
  enqueue(mutation: QueuedMutation): Promise<MutationOutcome> {
    // Synchronous: the row has to be on screen before this function returns,
    // which is the entire point of the overlay.
    clientStore.addPending(mutation)
    return new Promise<MutationOutcome>((resolve) => {
      queue.push({ mutation, resolve })
      void drain()
    })
  },

  /** Test seam only — the queue is a module singleton like the bus. */
  reset(): void {
    queue.length = 0
    draining = false
    failureListeners.clear()
  },
}

async function drain(): Promise<void> {
  if (draining) return
  draining = true
  try {
    while (queue.length > 0) {
      const entry = queue.shift()
      if (entry === undefined) break
      const outcome = await attempt(entry.mutation)
      if (outcome.ok) {
        clientStore.confirmPending(entry.mutation.id, outcome.canonical)
      } else {
        clientStore.dropPending(entry.mutation.id)
        announceFailure(entry.mutation, outcome.error)
        dropDependents(entry.mutation)
      }
      entry.resolve(outcome)
    }
  } finally {
    draining = false
  }
}

/**
 * Run one mutation, retrying a failing SERVER but never giving up on a missing
 * NETWORK.
 *
 * This used to cap an offline park at 15s and spend an attempt slot on it, so
 * a write made in a tunnel rolled back about 45 seconds later and the user's
 * paragraph vanished. The reasoning behind the cap was sound and is worth
 * restating, because it is the thing that changed: the queue is serial, so an
 * indefinite park on the head strands every mutation behind it.
 *
 * What makes parking correct now is that being stranded is VISIBLE. A held
 * write keeps its overlay, the count appears in the offline chip, and the
 * manifest panel lists it by name — so waiting is a state the user can see and
 * reason about, where before it was silent and the only honest thing to do was
 * time out. Losing work to a timer is worse than waiting for a network, once
 * the waiting is legible.
 */
async function attempt(mutation: QueuedMutation): Promise<MutationOutcome> {
  let lastError = "Something went wrong."
  let attempts = 0

  for (;;) {
    // Offline is not a failed attempt. Park, then re-check — the network
    // returning is the only thing that can make this mutation succeed.
    if (config.isOffline()) {
      await config.waitForOnline()
      continue
    }

    attempts++

    // Bracket ONLY the awaited call, exactly as hooks/use-generation.ts does:
    // scheduleRefresh's fire loop defers while pending > 0, so a counter that
    // spanned a backoff wait or an offline park would stall the RSC lane for
    // as long as the queue was waiting.
    localRefresh.pending++
    try {
      // A resolved { ok: false } is a SERVER rejection — the write was seen and
      // refused, so retrying it can only fail identically.
      const outcome = await mutation.run()
      reportRequestSuccess()
      return outcome
    } catch (error) {
      lastError = errorMessage(error)
      // A thrown run() is a transport failure. Let the connection machine
      // decide whether that means offline; it probes rather than taking one
      // caller's word for it.
      reportRequestFailure()
    } finally {
      localRefresh.pending--
    }

    // The network died under that attempt. Loop back to the park rather than
    // spending the budget on a server that is not reachable.
    if (config.isOffline()) continue
    if (attempts >= MAX_ATTEMPTS) break
    await waitBackoff(attempts - 1)
  }

  return { ok: false, error: lastError }
}

/** The online retry ladder. Offline never reaches here — see attempt(). */
function waitBackoff(index: number): Promise<void> {
  const ms = config.backoffMs[index] ?? config.backoffMs.at(-1) ?? 0
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * A queued mutation that patches a row this one was creating can never succeed
 * — the row does not exist and now never will — so it is dropped with the same
 * rollback, transitively.
 */
function dropDependents(failed: QueuedMutation): void {
  const orphaned = createdIds(failed)
  if (orphaned.size === 0) return

  let scanning = true
  while (scanning) {
    scanning = false
    for (let i = queue.length - 1; i >= 0; i--) {
      const entry = queue[i]
      const touches = entry.mutation.patches.some((patch) =>
        orphaned.has(patch.op === "upsert" ? patch.row.id : patch.id)
      )
      if (!touches) continue
      queue.splice(i, 1)
      for (const id of createdIds(entry.mutation)) {
        if (!orphaned.has(id)) {
          orphaned.add(id)
          scanning = true
        }
      }
      clientStore.dropPending(entry.mutation.id)
      entry.resolve({ ok: false, error: DEPENDENCY_FAILED })
    }
  }
}

function createdIds(mutation: QueuedMutation): Set<string> {
  const ids = new Set<string>()
  for (const patch of mutation.patches) {
    if (patch.op === "upsert") ids.add(patch.row.id)
  }
  return ids
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message
  return "Something went wrong."
}
