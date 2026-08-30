// lib/store/lore-revalidate.ts — The lorebook's catch-up read.
//
// The story lane's twin (lib/store/revalidate.ts), with the same three
// properties for the same reasons: DEBOUNCED so a multi-row write collapses to
// one read, SINGLE-FLIGHT PER STORY so a slow stale response can never land on
// top of a newer apply, and RETRIED until it succeeds, because a failed gap
// recovery leaves a device quietly wrong.
//
// Separate from the story lane rather than folded into it because the reads are
// not the same shape. A story reconcile is one library-wide question with a
// delta mode and a high-water mark; lore has neither — it is one complete read
// per story, and a device holds only the stories it has opened.
//
// Client-safe, no React.

import { clientStore } from "@/lib/store/store"
import type { LorebookEntryRecord } from "@/lib/store/records"

const DEBOUNCE_MS = 300

const RETRY_BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000]

const FETCH_TIMEOUT_MS = 10_000

interface SnapshotResponse {
  rows: Array<{ id: string; version: string; row: LorebookEntryRecord }>
}

/** Stories with a read pending behind the debounce. */
const debounced = new Set<string>()
let debounceTimer: ReturnType<typeof setTimeout> | null = null

/** storyId → the read in flight, so a second ask joins it instead of racing. */
const inFlight = new Map<string, Promise<void>>()
/** storyId → true when work arrived while a read was in flight. */
const queued = new Set<string>()

const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const retryAttempts = new Map<string, number>()

/** Collapse a burst of lore writes on one story into a single read. */
export function scheduleLoreRevalidate(storyId: string): void {
  debounced.add(storyId)
  if (debounceTimer !== null) return
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    const ids = [...debounced]
    debounced.clear()
    for (const id of ids) void revalidateLoreNow(id)
  }, DEBOUNCE_MS)
}

/**
 * Read one story's lore now. A call arriving while that story's read is in
 * flight is remembered and run after it, so two applies never cross.
 */
export function revalidateLoreNow(storyId: string): Promise<void> {
  clearRetry(storyId)

  const existing = inFlight.get(storyId)
  if (existing !== undefined) {
    queued.add(storyId)
    return existing
  }

  const running = (async () => {
    try {
      do {
        queued.delete(storyId)
        await run(storyId)
      } while (queued.has(storyId))
    } finally {
      inFlight.delete(storyId)
    }
  })()

  inFlight.set(storyId, running)
  return running
}

/** Test seam — the lane is a module singleton like the story one. */
export function resetForTests(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = null
  debounced.clear()
  inFlight.clear()
  queued.clear()
  for (const timer of retryTimers.values()) clearTimeout(timer)
  retryTimers.clear()
  retryAttempts.clear()
}

async function run(storyId: string): Promise<void> {
  try {
    // Captured BEFORE the request goes out: a row learned about while it was in
    // flight has a higher seq, and the snapshot's silence about it proves
    // nothing. Same guard as the story lane's sweep.
    const issueSeq = clientStore.currentIngestSeq()
    const body = await readSnapshot(
      `/api/store/snapshot?entity=lorebook-entry&storyId=${encodeURIComponent(storyId)}`
    )
    clientStore.applyLoreSnapshot(storyId, body.rows, issueSeq)
    retryAttempts.delete(storyId)
  } catch {
    scheduleRetry(storyId)
  }
}

async function readSnapshot(url: string): Promise<SnapshotResponse> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`lore snapshot ${response.status}`)
  const body = (await response.json()) as SnapshotResponse
  if (!Array.isArray(body.rows)) throw new Error("lore snapshot has no rows")
  return body
}

/** Capped at 30s and never given up on, exactly as the story lane retries. */
function scheduleRetry(storyId: string): void {
  const attempt = retryAttempts.get(storyId) ?? 0
  const ms =
    RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)] ?? 30_000
  retryAttempts.set(storyId, attempt + 1)
  clearRetry(storyId)
  retryTimers.set(
    storyId,
    setTimeout(() => {
      retryTimers.delete(storyId)
      void revalidateLoreNow(storyId)
    }, ms)
  )
}

function clearRetry(storyId: string): void {
  const timer = retryTimers.get(storyId)
  if (timer === undefined) return
  clearTimeout(timer)
  retryTimers.delete(storyId)
}
