"use client"

// lib/story/workspace-cache.ts — Opened stories, kept in memory.
//
// The point of the whole exercise: a story already opened once repaints from
// here with no network at all, and the fetch that follows is a correction
// nobody waits for. Memory only, deliberately — a manuscript is far larger than
// the story rows the store persists, and a stale one painted from disk at boot
// would be a worse lie than a skeleton.
//
// Bounded because it holds manuscripts: MAX_ENTRIES stories, least-recently
// read evicted first, which is more than any switching burst reaches for.

import type { StoryWorkspacePayload } from "@/lib/story/workspace-payload"

const MAX_ENTRIES = 8

const cache = new Map<string, StoryWorkspacePayload>()
const inFlight = new Map<string, Promise<FetchOutcome>>()
const listeners = new Set<() => void>()

export type FetchOutcome =
  | { kind: "ok"; payload: StoryWorkspacePayload }
  | { kind: "missing" }
  | { kind: "error"; message: string }

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function announce(): void {
  for (const listener of listeners) listener()
}

/** Re-inserted on read so eviction is least-recently-used, not insertion order. */
export function getCachedPayload(
  storyId: string
): StoryWorkspacePayload | undefined {
  const hit = cache.get(storyId)
  if (hit === undefined) return undefined
  cache.delete(storyId)
  cache.set(storyId, hit)
  return hit
}

export function putCachedPayload(
  storyId: string,
  payload: StoryWorkspacePayload
): void {
  cache.delete(storyId)
  cache.set(storyId, payload)
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (oldest.done === true) break
    cache.delete(oldest.value)
  }
  announce()
}

export function dropCachedPayload(storyId: string): void {
  if (cache.delete(storyId)) announce()
}

export function clearWorkspaceCacheForTests(): void {
  cache.clear()
  inFlight.clear()
}

/**
 * One request per story in flight at a time. Two callers asking at once — the
 * mount and the revision effect firing in the same tick — share the answer
 * rather than racing two reads of the same eight queries.
 */
export function fetchWorkspacePayload(storyId: string): Promise<FetchOutcome> {
  const existing = inFlight.get(storyId)
  if (existing !== undefined) return existing

  const request = (async (): Promise<FetchOutcome> => {
    try {
      const res = await fetch(
        `/api/story/${encodeURIComponent(storyId)}/workspace`,
        { cache: "no-store" }
      )
      if (res.status === 404) return { kind: "missing" }
      if (!res.ok)
        return { kind: "error", message: `Request failed (${res.status}).` }
      const payload = (await res.json()) as StoryWorkspacePayload
      putCachedPayload(storyId, payload)
      return { kind: "ok", payload }
    } catch {
      // Offline, or the tab was suspended mid-flight. The caller keeps whatever
      // it had painted; this is a correction that did not arrive, not a loss.
      return { kind: "error", message: "Could not reach the server." }
    } finally {
      inFlight.delete(storyId)
    }
  })()

  inFlight.set(storyId, request)
  return request
}
