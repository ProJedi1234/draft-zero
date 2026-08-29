import { LibraryView } from "@/components/library/library-view"

/**
 * The library index, and — more load-bearing than it looks — the one URL in
 * the app that is not a story (see LibraryView for the store-driven body).
 *
 * This route used to redirect to your most recent story, which quietly broke
 * every installed copy: iOS saves whatever URL you are on when you add to the
 * home screen and offers no way to edit it, so a non-story URL has to exist
 * and stay reachable for the PWA `start_url` to mean anything.
 */
export default function Page() {
  return <LibraryView />
}
