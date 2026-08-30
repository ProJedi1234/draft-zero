// lib/store/mutation-queue.ts — Optimistic writes: one serial queue, one
// overlay, no inverse patches.
//
// The model is confirmed-plus-overlay rather than apply-then-undo. Enqueueing
// makes a change visible synchronously; rollback is dropping the entry, so a
// foreign write that landed underneath the overlay while the mutation was in
// flight survives a rollback untouched. Confirming folds the action's own
// returned rows into confirmed — idempotent with the bus echo of the same
// write, because both go through the store's event rule.

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

/** Total attempts per mutation, retries included. */
const MAX_ATTEMPTS = 3

const DEFAULT_BACKOFF_MS = [1000, 2000, 5000]

/** The cap on an offline park. See waitBetweenAttempts. */
const DEFAULT_OFFLINE_WAIT_MS = 15_000

const DEPENDENCY_FAILED = "A change this depended on failed."

interface QueueConfig {
  backoffMs: number[]
  offlineWaitMs: number
  isOffline(): boolean
  waitForOnline(timeoutMs: number): Promise<void>
}

function defaultIsOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false
}

function defaultWaitForOnline(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (typeof window !== "undefined") {
        window.removeEventListener("online", finish)
      }
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    if (typeof window !== "undefined") {
      window.addEventListener("online", finish, { once: true })
    }
  })
}

const config: QueueConfig = {
  backoffMs: [...DEFAULT_BACKOFF_MS],
  offlineWaitMs: DEFAULT_OFFLINE_WAIT_MS,
  isOffline: defaultIsOffline,
  waitForOnline: defaultWaitForOnline,
}

/** Test seam: shorten the ladder, or fake the offline signal. */
export function configureMutationQueue(patch: Partial<QueueConfig>): void {
  Object.assign(config, patch)
}

export function resetMutationQueueConfig(): void {
  config.backoffMs = [...DEFAULT_BACKOFF_MS]
  config.offlineWaitMs = DEFAULT_OFFLINE_WAIT_MS
  config.isOffline = defaultIsOffline
  config.waitForOnline = defaultWaitForOnline
}

interface QueueEntry {
  mutation: QueuedMutation
  resolve: (outcome: MutationOutcome) => void
}

const queue: QueueEntry[] = []
let draining = false

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
        dropDependents(entry.mutation)
      }
      entry.resolve(outcome)
    }
  } finally {
    draining = false
  }
}

async function attempt(mutation: QueuedMutation): Promise<MutationOutcome> {
  let lastError = "Something went wrong."

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    // Bracket ONLY the awaited call, exactly as hooks/use-generation.ts does:
    // scheduleRefresh's fire loop defers while pending > 0, so a counter that
    // spanned a backoff wait or an offline park would stall the RSC lane for
    // as long as the queue was waiting.
    localRefresh.pending++
    try {
      // A resolved { ok: false } is a SERVER rejection — the write was seen and
      // refused, so retrying it can only fail identically.
      return await mutation.run()
    } catch (error) {
      lastError = errorMessage(error)
    } finally {
      localRefresh.pending--
    }

    if (i === MAX_ATTEMPTS - 1) break
    await waitBetweenAttempts(i)
  }

  return { ok: false, error: lastError }
}

/**
 * A thrown run() is a network failure, so wait and try again. Offline, the wait
 * is the online event OR 15s, whichever lands first — capped, and consuming an
 * attempt slot either way, because this is a SERIAL queue: an indefinite park
 * on the head strands every mutation behind it, and every one of them is a
 * write the user made seconds ago. Worst case a mutation settles in under a
 * minute whether the network came back or not.
 */
function waitBetweenAttempts(index: number): Promise<void> {
  if (config.isOffline()) return config.waitForOnline(config.offlineWaitMs)
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
