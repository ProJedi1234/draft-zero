import { LibraryView } from "@/components/library/library-view"
import { listGalleryImages, listStoryExcerpts } from "@/lib/db/queries"
import { listActiveImageRuns } from "@/lib/images/live"
import { listActiveRuns } from "@/lib/generation/live"

/** How many pictures the rail carries before it runs off the edge. */
const RAIL_LIMIT = 12

/**
 * The library index, and — more load-bearing than it looks — the one URL in
 * the app that is not a story (see LibraryView for the store-driven body).
 *
 * This route used to redirect to your most recent story, which quietly broke
 * every installed copy: iOS saves whatever URL you are on when you add to the
 * home screen and offers no way to edit it, so a non-story URL has to exist
 * and stay reachable for the PWA `start_url` to mean anything.
 *
 * The stories themselves still come from the client store. What is read here
 * is only what the store does not hold: the prose of each story's latest
 * passage, and the newest pictures.
 */
export default async function Page() {
  const [excerpts, images] = await Promise.all([
    listStoryExcerpts(),
    listGalleryImages({ limit: RAIL_LIMIT }),
  ])
  // Both kinds, like the sidebar: a story drawing a picture is busy in exactly
  // the way one streaming prose is.
  const activeRuns = [...listActiveRuns(), ...listActiveImageRuns()]

  return (
    <LibraryView
      excerpts={excerpts}
      railImages={images}
      activeRuns={activeRuns}
    />
  )
}
