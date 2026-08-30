"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import type { StorySummary } from "@/lib/types"
import type { StoryView } from "@/lib/store/store"
import { formatRelativeDate } from "@/lib/format"
import { useElapsed } from "@/hooks/use-elapsed"
import type { RunStatus } from "@/hooks/use-run-status"
import {
  StoryRunMark,
  type RunMarkState,
} from "@/components/sidebar/story-run-mark"
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { StoryActionsMenu } from "@/components/story/story-actions-menu"

/**
 * The line under the title. A story that is doing something says so; every
 * other story keeps the genre and date it has always shown.
 *
 * Elapsed time replaces the genre rather than joining it because the genre
 * never changes and this does — and because it is the only number that
 * distinguishes a slow run from a wedged one.
 */
function subtitleFor(
  story: StorySummary,
  state: RunMarkState,
  elapsed: string | null
): string {
  if (state === "working")
    return elapsed === null ? "writing" : `writing · ${elapsed}`
  if (state === "done") return "new passage"
  if (state === "failed") return "stopped"
  return `${story.genre ? `${story.genre} · ` : ""}${formatRelativeDate(story.updatedAt)}`
}

export function StoryListItem({
  story,
  run,
}: {
  story: StoryView
  run: RunStatus
}) {
  const pathname = usePathname()
  const isActive = pathname === `/story/${story.id}`
  const elapsed = useElapsed(run.state === "working" ? run.startedAt : null)
  // A ghost create's route does not exist until the insert commits, so a
  // pending row is a plain button rather than a link into a 404.
  const pending = story.pending

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={pending ? undefined : isActive}
        aria-disabled={pending || undefined}
        className={cn(
          "h-auto py-2",
          pending && "pointer-events-none opacity-60"
        )}
        // prefetch: the story route carries no data any more, so its payload is
        // a few hundred bytes and the workspace itself comes from the client
        // cache. Without this the navigation hop is the only thing left that
        // makes switching stories feel slow.
        render={
          pending ? undefined : (
            <Link href={`/story/${story.id}`} prefetch={true} />
          )
        }
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{story.title}</span>
          <span
            className={cn(
              "truncate text-xs text-muted-foreground",
              run.state === "failed" && "text-destructive"
            )}
          >
            {subtitleFor(story, run.state, elapsed)}
          </span>
        </div>
      </SidebarMenuButton>
      {/*
        Shares the kebab's slot — same coordinates, same 20px box — so no row
        grows or shrinks and no title gives up width. Hovering swaps the mark
        for the kebab, which is the price: hover is one row at a time, aimed at
        the row being opened, where the manuscript gives the full answer a
        click later. On touch there is no hover at all.
      */}
      <span className="pointer-events-none absolute top-2 right-1 flex size-5 items-center justify-center group-focus-within/menu-item:opacity-0 group-hover/menu-item:opacity-0">
        <StoryRunMark state={run.state} />
      </span>
      <StoryActionsMenu
        story={story}
        trigger={<SidebarMenuAction showOnHover aria-label="Story actions" />}
        side="right"
        align="start"
        closeOnSidebarCollapse
        navigateOnDuplicate
      />
    </SidebarMenuItem>
  )
}
