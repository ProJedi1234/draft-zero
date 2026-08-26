"use client"

import Link from "next/link"

import type { StorySummary } from "@/lib/types"
import { formatRelativeDate } from "@/lib/format"
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
export function StoryCard({ story }: { story: StorySummary }) {
  const wordCount = story.wordCount ?? 0

  return (
    <div className="group relative flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 pr-2 transition-colors hover:border-border hover:bg-card/80 focus-within:border-border">
      <Link
        href={`/story/${story.id}`}
        className="min-w-0 flex-1 px-4 py-3 outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring/30"
      >
        <span className="block truncate font-medium">{story.title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {story.genre ? `${story.genre} · ` : ""}
          {formatRelativeDate(story.updatedAt)}
          {wordCount > 0 ? ` · ${wordCount.toLocaleString()} words` : ""}
        </span>
      </Link>
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
    </div>
  )
}
