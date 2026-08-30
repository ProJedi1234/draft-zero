"use client"

// components/store-boot.tsx — The client store's cold start, mounted once in
// the root layout. Renders nothing; it exists for its effect.
//
// Three steps in order: paint whatever IndexedDB held so the library is not a
// skeleton while the network thinks, reconcile against server truth, then keep
// the cache written behind the store. The reconcile keeps retrying on its own
// and every `hello` schedules another, so a boot that cannot reach the server
// stays on a skeleton rather than settling into a wrong-but-confident empty.

import * as React from "react"

import { createPersister, openIdbPersistence } from "@/lib/store/persistence"
import type { LorebookEntryRecord, StoryRecord } from "@/lib/store/records"
import { revalidateStoriesNow } from "@/lib/store/revalidate"
import { attachWorkspacePersistence } from "@/lib/story/workspace-cache"
import { clientStore, type SnapshotRow } from "@/lib/store/store"

export function StoreBoot(): null {
  React.useEffect(() => {
    let disposed = false
    const teardown: Array<() => void> = []

    void (async () => {
      const persistence = await openIdbPersistence()
      if (disposed) return

      if (persistence !== null) {
        const [cached, cachedLore] = await Promise.all([
          persistence.load("story"),
          persistence.load("lorebook-entry"),
        ])
        if (disposed) return
        if (cached.length > 0) {
          clientStore.adoptCacheRows(cached as SnapshotRow<StoryRecord>[])
        }
        // Lore from disk for the same reason manuscripts are: opening the
        // lorebook after a relaunch should paint entries, not a skeleton. Still
        // a cache — the partition read that follows on mount corrects it.
        if (cachedLore.length > 0) {
          clientStore.adoptLoreCacheRows(
            cachedLore as SnapshotRow<LorebookEntryRecord>[]
          )
        }
        // Manuscripts too, so opening a story after a relaunch paints prose
        // rather than a skeleton. Awaited before the reconcile below for the
        // same reason the rows are: cache first, correction second.
        await attachWorkspacePersistence(persistence)
        if (disposed) return
      }

      void revalidateStoriesNow("reconcile")
      if (persistence === null || disposed) return

      const persister = createPersister(
        persistence,
        [
          { entity: "story", getRows: () => clientStore.confirmedStoryRows() },
          {
            entity: "lorebook-entry",
            getRows: () => clientStore.confirmedLoreRows(),
          },
        ],
        () => clientStore.getLastCompleteApplyAt()
      )
      const unsubscribe = clientStore.subscribe(persister.onStoreChanged)

      const flush = () => persister.flush()
      // The iOS freeze point, same as the composer draft hook: a backgrounded
      // PWA may never see another event after this one.
      const onHide = () => {
        if (document.visibilityState === "hidden") flush()
      }
      window.addEventListener("pagehide", flush)
      document.addEventListener("visibilitychange", onHide)

      teardown.push(() => {
        unsubscribe()
        window.removeEventListener("pagehide", flush)
        document.removeEventListener("visibilitychange", onHide)
        persister.dispose()
      })
    })()

    return () => {
      disposed = true
      for (const off of teardown) off()
    }
  }, [])

  return null
}

export default StoreBoot
