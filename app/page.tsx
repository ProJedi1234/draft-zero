import Link from "next/link"
import { Feather } from "lucide-react"

import { ImportScenarioButton } from "@/components/sidebar/import-scenario-button"
import { NewStoryButton } from "@/components/sidebar/new-story-button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { listStoriesWithCounts } from "@/lib/db/queries"
import { formatRelativeDate } from "@/lib/format"

/**
 * The library index, and — more load-bearing than it looks — the one URL in the
 * app that is not a story.
 *
 * This route used to redirect to your most recent story. That was pleasant on
 * desktop and quietly broke every installed copy: iOS saves whatever URL you
 * are on when you add to the home screen and offers no way to edit it, so with
 * no reachable non-story URL, an installed app was pinned forever to whichever
 * story happened to be open that day. A manifest `start_url` does not rescue
 * this — iOS keeps the saved URL, and pointing `start_url` at a redirect is its
 * own way to fall out of standalone at launch.
 *
 * So the redirect is gone and this renders. "Resume where I left off" is still
 * worth having, but it belongs behind an affordance on this page rather than in
 * a redirect that costs the app a stable entry point.
 */
export default async function Page() {
  // Server order is updatedAt DESC — the most recently touched story first.
  const stories = await listStoriesWithCounts()

  if (stories.length === 0) {
    return (
      <div className="flex h-app items-center justify-center">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Feather />
            </EmptyMedia>
            <EmptyTitle>Write your first story</EmptyTitle>
            <EmptyDescription>
              draft zero keeps everything on this machine. Start a draft and the
              library builds itself.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className="flex items-center gap-2">
              <NewStoryButton size="sm" />
              <ImportScenarioButton variant="button" />
            </div>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  return (
    <div className="h-app overflow-y-auto">
      {/*
        The bottom pad clears the home indicator when installed: the app paints
        edge to edge, so the last story in a scrolled list would otherwise sit
        under it. max() keeps the ordinary spacing everywhere the inset is 0.
      */}
      <div className="mx-auto w-full max-w-3xl px-4 pt-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6">
        {/*
          flex-wrap, and no shrink-0 on the actions: on a phone the heading and
          two labelled buttons are wider than the viewport, and a row that
          cannot shrink or wrap makes the whole page wider than the screen. That
          costs a horizontal scroll on the one screen the app opens to. Below
          ~sm the actions take their own line instead.
        */}
        <header className="mb-8 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <h1 className="min-w-0 font-serif text-2xl tracking-tight">
            Library
          </h1>
          <div className="flex items-center gap-2">
            <ImportScenarioButton variant="button" />
            <NewStoryButton size="sm" />
          </div>
        </header>

        <ul className="flex flex-col gap-2">
          {stories.map((story) => (
            <li key={story.id}>
              <Link
                href={`/story/${story.id}`}
                className="block rounded-lg border border-border/60 bg-card/40 px-4 py-3 transition-colors hover:border-border hover:bg-card/80"
              >
                <span className="block truncate font-medium">
                  {story.title}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {story.genre ? `${story.genre} · ` : ""}
                  {formatRelativeDate(story.updatedAt)}
                  {(story.wordCount ?? 0) > 0
                    ? ` · ${story.wordCount?.toLocaleString()} words`
                    : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
