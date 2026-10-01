import { LibraryView } from "@/components/library/library-view"
import { buildLibraryPayload } from "@/lib/payloads/library"

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
 * passage, the newest pictures, and the runs in flight — the same payload
 * GET /api/library serves the native client.
 */
export default async function Page() {
  const { excerpts, railImages, activeRuns } = await buildLibraryPayload()

  return (
    <LibraryView
      excerpts={excerpts}
      railImages={railImages}
      activeRuns={activeRuns}
    />
  )
}
