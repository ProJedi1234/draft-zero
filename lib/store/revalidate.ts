// lib/store/revalidate.ts — The store lane's catch-up read.
//
// The socket carries every write it is awake for; this fills the gaps it is
// not. Three things make it safe rather than merely eventual. It is DEBOUNCED,
// so a multi-row write collapses to one read. It is SINGLE-FLIGHT, so responses
// apply in the order they were issued — a slow stale snapshot can never land on
// top of a newer apply. And it RETRIES until it succeeds, because a failed gap
// recovery leaves a device permanently wrong, which is the one failure mode the
// socket cannot correct on its own.
//
// Client-safe, no React: the boot component and the sync hook both call in, and
// neither should re-render because a read is in flight.

import { clientStore, type SnapshotRow } from "@/lib/store/store"
import type { EntityKind, StoryRecord } from "@/lib/store/records"

/** Collapses a burst of change events into one read. */
const DEBOUNCE_MS = 300

/** Past this many distinct stories, one reconcile is cheaper than N scoped reads. */
const MAX_SCOPED_IDS = 8

const RETRY_BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000]

const FETCH_TIMEOUT_MS = 10_000

type Scope = "reconcile" | string[]

interface Work {
  reconcile: boolean
  ids: Set<string>
}

interface SnapshotResponse {
  rows: SnapshotRow<StoryRecord>[]
  allIds?: Array<{ id: string; version: string }>
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let debounced: Work = { reconcile: false, ids: new Set() }

/** The single-flight slot: work that arrived while a read was in flight. */
let slot: Work | null = null
let draining: Promise<void> | null = null

let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryWork: Work | null = null
let retryAttempt = 0

/**
 * Routing per design doc §2.2. A `change` with a storyId is one story's row; a
 * null-scoped one is a library-level write unless its `entities` hint says the
 * write never touched a story — a settings slider or a profile edit must not
 * make every device read the library back.
 */
export function scheduleStoreRevalidate(
  target: { storyId: string | null; entities?: EntityKind[] } | null
): void {
  if (target === null) {
    debounced.reconcile = true
  } else if (target.storyId !== null) {
    debounced.ids.add(target.storyId)
  } else {
    if (target.entities !== undefined && !target.entities.includes("story")) {
      return
    }
    debounced.reconcile = true
  }

  if (debounceTimer !== null) return
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    const work = debounced
    debounced = { reconcile: false, ids: new Set() }
    if (work.reconcile || work.ids.size > MAX_SCOPED_IDS) {
      void revalidateStoriesNow("reconcile")
      return
    }
    if (work.ids.size === 0) return
    void revalidateStoriesNow([...work.ids])
  }, DEBOUNCE_MS)
}

/**
 * Read now. Work arriving while a read is in flight merges into one pending
 * slot — reconcile supersedes scoped, scoped ids union — and runs after it, so
 * the store never applies two overlapping reads out of issue order.
 */
export function revalidateStoriesNow(scope: Scope): Promise<void> {
  // A newer schedule supersedes a pending retry's TIMER, not its work: the
  // failed read is folded into this one, so a scoped event arriving between a
  // failed reconcile and its retry cannot drop the reconcile on the floor.
  clearRetry()
  merge(scope)
  if (draining !== null) return draining

  draining = (async () => {
    try {
      while (slot !== null) {
        const work = slot
        slot = null
        await run(work)
      }
    } finally {
      draining = null
    }
  })()
  return draining
}

/** Test seam — the lane is a module singleton like the bus and the queue. */
export function resetForTests(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = null
  debounced = { reconcile: false, ids: new Set() }
  clearRetry()
  slot = null
  draining = null
  retryAttempt = 0
}

function merge(scope: Scope): void {
  const work = slot ?? { reconcile: false, ids: new Set<string>() }
  if (scope === "reconcile") work.reconcile = true
  else for (const id of scope) work.ids.add(id)
  slot = work
}

async function run(work: Work): Promise<void> {
  try {
    if (work.reconcile) await reconcile()
    else await scoped([...work.ids])
    retryAttempt = 0
  } catch {
    scheduleRetry(work)
  }
}

/**
 * A device that has reconciled once knows a high-water version, so it asks only
 * for what moved plus the id list the sweep needs. Boot — and any tab whose
 * snapshot has never landed — pays for the full aggregate once.
 */
async function reconcile(): Promise<void> {
  const status = clientStore.getState().story.status
  const max = clientStore.maxStoryVersion()

  if (status === "live" && max !== null) {
    const issueSeq = clientStore.currentIngestSeq()
    const body = await readSnapshot(
      `/api/store/snapshot?since=${encodeURIComponent(max)}`
    )
    if (!Array.isArray(body.allIds))
      throw new Error("delta snapshot has no allIds")
    clientStore.applySnapshot(
      body.rows,
      new Set(body.allIds.map((entry) => entry.id)),
      issueSeq
    )
    return
  }

  const issueSeq = clientStore.currentIngestSeq()
  const body = await readSnapshot("/api/store/snapshot")
  // A full snapshot's own rows ARE the complete id list; the route sends none.
  clientStore.applySnapshot(
    body.rows,
    new Set(body.rows.map((entry) => entry.id)),
    issueSeq
  )
}

async function scoped(ids: string[]): Promise<void> {
  for (const id of ids) {
    const issueSeq = clientStore.currentIngestSeq()
    const body = await readSnapshot(
      `/api/store/snapshot?storyId=${encodeURIComponent(id)}`
    )
    clientStore.applyScopedResult([id], body.rows, issueSeq)
  }
}

async function readSnapshot(url: string): Promise<SnapshotResponse> {
  // no-store because gap recovery that answers out of the browser's HTTP cache
  // recovers nothing; the timeout because this app's plain-HTTP LAN origin has
  // a 6-connection pool, and a request that hangs holds one of them forever.
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`snapshot ${response.status}`)
  const body = (await response.json()) as SnapshotResponse
  if (!Array.isArray(body.rows)) throw new Error("snapshot has no rows")
  return body
}

/**
 * The socket's discipline, capped at 30s and never given up on: a client whose
 * catch-up read failed is stale in a way nothing else will fix.
 */
function scheduleRetry(work: Work): void {
  const ms =
    RETRY_BACKOFF_MS[Math.min(retryAttempt, RETRY_BACKOFF_MS.length - 1)] ??
    30_000
  retryAttempt += 1
  clearRetry()
  retryWork = work
  retryTimer = setTimeout(() => {
    retryTimer = null
    retryWork = null
    void revalidateStoriesNow(work.reconcile ? "reconcile" : [...work.ids])
  }, ms)
}

function clearRetry(): void {
  if (retryTimer !== null) clearTimeout(retryTimer)
  retryTimer = null
  if (retryWork === null) return
  merge(retryWork.reconcile ? "reconcile" : [...retryWork.ids])
  retryWork = null
}
