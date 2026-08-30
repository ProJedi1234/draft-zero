"use client"

import Link from "next/link"

import { formatRelativeDate } from "@/lib/format"
import type { StoryView } from "@/lib/store/store"
import { useElapsed } from "@/hooks/use-elapsed"
import type { RunStatus } from "@/hooks/use-run-status"
import { Button } from "@/components/ui/button"
import { StoryRunMark } from "@/components/sidebar/story-run-mark"
import { StoryActionsMenu } from "@/components/story/story-actions-menu"
import { tintVars } from "@/components/library/tint"

/**
 * The line under the title. Same rule as the sidebar row — a story that is
 * doing something says so, and elapsed time replaces the genre rather than
 * joining it — with the word count the library has always shown kept on the
 * end, because it is the one fact here that is about the manuscript rather
 * than about right now.
 */
function metaFor(
  story: StoryView,
  run: RunStatus,
  elapsed: string | null
): string {
  const head =
    run.state === "working"
      ? elapsed === null
        ? "writing"
        : `writing · ${elapsed}`
      : run.state === "done"
        ? "new passage"
        : run.state === "failed"
          ? "stopped"
          : `${story.genre ? `${story.genre} · ` : ""}${formatRelativeDate(story.updatedAt)}`
  return story.wordCount > 0
    ? `${head} · ${story.wordCount.toLocaleString()} words`
    : head
}

/**
 * One story in the library list.
 *
 * The link is stretched over the card rather than wrapping it: the kebab is a
 * button, and a button inside an anchor is neither valid nor clickable. As a
 * sibling with the link's ::after covering the rest, the whole card still opens
 * the story and the menu keeps its own hit area.
 *
 * The kebab is always drawn, unlike the sidebar's — this page is the PWA's
 * start URL and gets opened on a phone, where showOnHover means never. Which
 * is also why the run mark sits BESIDE it rather than sharing its slot the way
 * the sidebar's does: with no hover to trade against, the two have to coexist.
 */
export function StoryCard({
  story,
  excerpt,
  run,
}: {
  story: StoryView
  /** The tail of the story's latest passage, or undefined for an empty one. */
  excerpt?: string
  run: RunStatus
}) {
  const elapsed = useElapsed(run.state === "working" ? run.startedAt : null)
  const meta = metaFor(story, run, elapsed)

  const body = (
    <>
      <span className="block truncate font-medium">{story.title}</span>
      {excerpt ? (
        <span className="mt-1 block truncate font-serif text-sm text-foreground/70">
          {excerpt}
        </span>
      ) : null}
      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
        {meta}
      </span>
    </>
  )

  return (
    // The tint rides the outer element, not the link: the wrapper is what
    // carries the card's own surface, and the two variables have to reach the
    // .story-card rule painting the wash and spine underneath everything.
    <div
      className="story-card group relative flex items-center gap-1 rounded-lg border border-border/60 bg-card/40 pr-2 transition-colors focus-within:border-border hover:border-border hover:bg-card/80"
      style={tintVars(story)}
    >
      {story.pending ? (
        // A ghost create's route would 404 until the insert commits, so it
        // gets the same block, minus the link and its focus ring.
        <div className="min-w-0 flex-1 px-4 py-3 opacity-60">{body}</div>
      ) : (
        <Link
          href={`/story/${story.id}`}
          // Same reason as the sidebar's row: the route is a shell now, so the
          // navigation hop is worth removing and cheap to prefetch.
          prefetch={true}
          className="min-w-0 flex-1 px-4 py-3 outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring/30"
        >
          {body}
        </Link>
      )}
      {story.pending ? null : (
        <>
          {/* Status reaches a screen reader through the meta line above, which
              already says "writing" in words. */}
          <StoryRunMark state={run.state} className="shrink-0" />
          <StoryActionsMenu
            story={story}
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Story actions"
                // Above the stretched link, which otherwise swallows the click.
                className="relative z-10 rounded-md text-muted-foreground/60 hover:text-foreground"
              />
            }
          />
        </>
      )}
    </div>
  )
}
