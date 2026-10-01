// lib/payloads/library.ts — What the library index reads beyond the client
// store: each story's latest prose, the newest pictures, and the runs in flight.
//
// The page and GET /api/library read this one function, so the web library and
// the native one show the same excerpts and the same live marks.

import { listGalleryImages, listStoryExcerpts } from "@/lib/db/queries"
import { listActiveRuns } from "@/lib/generation/live"
import { listActiveImageRuns } from "@/lib/images/live"
import type { ActiveRun } from "@/lib/sync/types"
import type { GalleryImage } from "@/lib/types"

/** How many pictures the rail carries before it runs off the edge. */
export const LIBRARY_RAIL_LIMIT = 12

export interface LibraryPayload {
  /** The tail of each story's newest live passage, keyed by story id. */
  excerpts: Record<string, string>
  /** The newest pictures across every story, newest first. */
  railImages: GalleryImage[]
  /** Text and image runs alike: a story drawing a picture is busy too. */
  activeRuns: ActiveRun[]
}

export async function buildLibraryPayload(): Promise<LibraryPayload> {
  const [excerpts, railImages] = await Promise.all([
    listStoryExcerpts(),
    listGalleryImages({ limit: LIBRARY_RAIL_LIMIT }),
  ])
  // Synchronous and in-process: the registries are Maps, not queries.
  const activeRuns = [...listActiveRuns(), ...listActiveImageRuns()]
  return { excerpts, railImages, activeRuns }
}
