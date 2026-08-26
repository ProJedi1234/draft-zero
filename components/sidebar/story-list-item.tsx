"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import type { StorySummary } from "@/lib/types"
import { formatElapsed, formatRelativeDate } from "@/lib/format"
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
 * The wall clock in whole seconds, re-read once a second while `active`.
 *
 * useSyncExternalStore rather than state and an effect, for two reasons that
 * happen to have the same answer. The server has no clock worth rendering —
 * its snapshot is deliberately SENTINEL, so the HTML ships "writing" with no
 * number and the first client paint agrees with it rather than hydrating over
 * a second-old string. And re-reading the clock beats incrementing a counter:
 * a backgrounded tab throttles timers, and a counter would come back visibly
 * behind the wall clock the writer actually waited through.
 */
const SENTINEL = 0

function useSecondTick(active: boolean): number {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      if (!active) return () => {}
      const timer = setInterval(onChange, 1000)
      return () => clearInterval(timer)
    },
    [active]
  )
  return React.useSyncExternalStore(
    subscribe,
    () => (active ? Math.floor(Date.now() / 1000) : SENTINEL),
    () => SENTINEL
  )
}

/**
 * How long this story's run has been going, or null before the clock is
 * available — on the server, and for the first client paint.
 *
 * Owned by the row rather than by useRunStatus deliberately: a clock in the
 * hook would re-render every story in the library once a second to update one
 * word on one of them.
 */
function useElapsed(startedAt: string | null): string | null {
  const seconds = useSecondTick(startedAt !== null)
  if (startedAt === null || seconds === SENTINEL) return null
  return formatElapsed(startedAt, seconds * 1000)
}

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
  story: StorySummary
  run: RunStatus
}) {
  const pathname = usePathname()
  const isActive = pathname === `/story/${story.id}`
  const elapsed = useElapsed(run.state === "working" ? run.startedAt : null)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        className="h-auto py-2"
        render={<Link href={`/story/${story.id}`} />}
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
