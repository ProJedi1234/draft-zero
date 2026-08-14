"use client"

import { useStorySync } from "@/hooks/use-story-sync"

/**
 * Holds the app's one /api/sync/events connection, mounted from the root
 * layout so it exists on every page — the library (the PWA's start_url), the
 * lorebook, settings, usage — not just inside an open story. Renders nothing:
 * the sync is invisible by design.
 */
export function SyncListener() {
  useStorySync()
  return null
}
