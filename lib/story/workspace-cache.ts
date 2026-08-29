"use client"

// lib/story/workspace-cache.ts — Opened stories, kept in memory and on disk.
//
// The point of the whole exercise: a story already opened repaints from here
// with no network at all, and the fetch that follows is a correction nobody
// waits for. Backed by IndexedDB so that survives a reload, a relaunch, or iOS
// evicting a backgrounded tab — without it the app is only fast while its tab
// stays alive, which is not what a local-first app feels like.
//
// A stale manuscript painted from disk is fine and is the whole trick: the
// refetch that follows replaces anything the server disagrees with, exactly as
// the story rows already work.

import {
  type PersistedWorkspace,
  type StorePersistence,
} from "@/lib/store/persistence"
import type { StoryWorkspacePayload } from "@/lib/story/workspace-payload"

/**
 * How many manuscripts are held, in memory and on disk.
 *
 * Matched to the sidebar's own window (components/sidebar/story-list.tsx
 * WINDOW, and STORY_PAGE_SIZE behind it): the stories a reader can reach
 * without asking for more are the stories worth having ready. Story ROWS are
 * not bounded this way — they are a few hundred bytes each and the sidebar
 * searches them in memory — but a manuscript is tens of kilobytes, so a
 * library of hundreds of stories would otherwise grow this without limit.
 */
export const WORKSPACE_CACHE_LIMIT = 20

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
  while (cache.size > WORKSPACE_CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (oldest.done === true) break
    cache.delete(oldest.value)
  }
  announce()
  void writeThrough(storyId, payload)
}

// ── disk ────────────────────────────────────────────────────────────────────

let store: StorePersistence | null = null

/**
 * Hands the cache its disk, and paints whatever was already there.
 *
 * Called once from the boot effect. Everything before this point still works —
 * the cache is simply memory-only until the database opens, which is also what
 * happens in a browser that refuses IndexedDB (private mode, blocked site
 * data).
 */
export async function attachWorkspacePersistence(
  persistence: StorePersistence
): Promise<void> {
  store = persistence
  const saved = await persistence.loadWorkspaces()
  // Newest first, so the evicting insert below keeps the freshest if a saved
  // set ever exceeds the limit (a cache written by an older, larger budget).
  saved.sort((a, b) => b.savedAt - a.savedAt)
  for (const entry of saved) {
    if (cache.has(entry.id)) continue // a live fetch already won
    if (cache.size >= WORKSPACE_CACHE_LIMIT) break
    cache.set(entry.id, entry.payload as StoryWorkspacePayload)
  }
  if (saved.length > 0) announce()
}

async function writeThrough(
  storyId: string,
  payload: StoryWorkspacePayload
): Promise<void> {
  const persistence = store
  if (persistence === null) return
  const entry: PersistedWorkspace = {
    id: storyId,
    version: payload.story.updatedAt,
    savedAt: Date.now(),
    payload,
  }
  await persistence.putWorkspace(entry)
  await persistence.keepWorkspaces([...cache.keys()])
}

export function dropCachedPayload(storyId: string): void {
  if (cache.delete(storyId)) announce()
}

export function clearWorkspaceCacheForTests(): void {
  cache.clear()
  inFlight.clear()
  store = null
}

/** The ids currently held, newest-written last. */
export function cachedStoryIdsForTests(): string[] {
  return [...cache.keys()]
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
