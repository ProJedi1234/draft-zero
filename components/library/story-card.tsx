"use client"

import * as React from "react"
import Link from "next/link"

import { formatRelativeDate } from "@/lib/format"
import type { StoryView } from "@/lib/store/store"
import { Button } from "@/components/ui/button"
import { StoryActionsMenu } from "@/components/story/story-actions-menu"

/**
 * One story in the library index.
 *
 * The link is stretched over the card rather than wrapping it: the kebab is a
 * button, and a button inside an anchor is neither valid nor clickable. As a
 * sibling with the link's ::after covering the rest, the whole card still opens
 * the story and the menu keeps its own hit area.
 *
 * The kebab is always drawn, unlike the sidebar's — this page is the PWA's
 * start URL and gets opened on a phone, where showOnHover means never.
 */
export function StoryCard({ story }: { story: StoryView }) {
  const wordCount = story.wordCount

  return (
    // The tint rides the outer element, not the link: the wrapper is what
    // carries the card's own surface, and the two variables have to reach the
    // .story-card rule painting the wash and spine underneath everything.
    <div
      className="story-card group relative flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 pr-2 transition-colors focus-within:border-border hover:border-border hover:bg-card/80"
      style={
        {
          "--story-h": story.tintHue ?? 0,
          "--story-c": story.tintHue === null ? 0 : story.tintStrength,
        } as React.CSSProperties
      }
    >
      {story.pending ? (
        // A ghost create's route would 404 until the insert commits, so it
        // gets the same block, minus the link and its focus ring.
        <div className="min-w-0 flex-1 px-4 py-3 opacity-60">
          <span className="block truncate font-medium">{story.title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {story.genre ? `${story.genre} · ` : ""}
            {formatRelativeDate(story.updatedAt)}
            {wordCount > 0 ? ` · ${wordCount.toLocaleString()} words` : ""}
          </span>
        </div>
      ) : (
        <Link
          href={`/story/${story.id}`}
          // Same reason as the sidebar's row: the route is a shell now, so the
          // navigation hop is worth removing and cheap to prefetch.
          prefetch={true}
          className="min-w-0 flex-1 px-4 py-3 outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring/30"
        >
          <span className="block truncate font-medium">{story.title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {story.genre ? `${story.genre} · ` : ""}
            {formatRelativeDate(story.updatedAt)}
            {wordCount > 0 ? ` · ${wordCount.toLocaleString()} words` : ""}
          </span>
        </Link>
      )}
      {story.pending ? null : (
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
      )}
    </div>
  )
}
