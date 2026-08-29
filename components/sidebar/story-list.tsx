"use client"

import * as React from "react"
import { Loader2, Plus } from "lucide-react"

import {
  filterStories,
  showLibrarySkeleton,
  useMutationQueueDepth,
  useStories,
} from "@/hooks/use-store"
import type { RunStatus } from "@/hooks/use-run-status"
import { Button } from "@/components/ui/button"
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@/components/ui/sidebar"
import { ImportScenarioButton } from "@/components/sidebar/import-scenario-button"
import {
  NewStoryButton,
  useCreateStory,
} from "@/components/sidebar/new-story-button"
import { StoryListItem } from "@/components/sidebar/story-list-item"

/** How many rows are rendered before "Load more" adds another window. */
const WINDOW = 20

export function StoryList({
  query,
  runStatus,
}: {
  query: string
  /** What each story is doing — see hooks/use-run-status.ts. */
  runStatus: (storyId: string) => RunStatus
}) {
  const { createNewStory, isPending } = useCreateStory()
  const trimmedQuery = query.trim()
  // The store holds the whole library, so search never reaches the server: it
  // is a filter over rows already in memory, answered on the keystroke.
  const { rows, status } = useStories()
  const filtered = React.useMemo(
    () => filterStories(rows, trimmedQuery),
    [rows, trimmedQuery]
  )
  const depth = useMutationQueueDepth()

  // Render-time reset rather than an effect: a new query starts at the first
  // window, and adjusting during render avoids painting the old count first.
  const [visibleCount, setVisibleCount] = React.useState(WINDOW)
  const [lastQuery, setLastQuery] = React.useState(trimmedQuery)
  if (lastQuery !== trimmedQuery) {
    setLastQuery(trimmedQuery)
    setVisibleCount(WINDOW)
  }

  const visible = filtered.slice(0, visibleCount)

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Library</SidebarGroupLabel>
      <SidebarGroupAction
        title="New story"
        onClick={createNewStory}
        disabled={isPending}
      >
        {isPending ? <Loader2 className="animate-spin" /> : <Plus />}
        <span className="sr-only">New story</span>
      </SidebarGroupAction>
      <ImportScenarioButton />
      <SidebarGroupContent>
        {showLibrarySkeleton(rows, status) ? (
          <div className="flex flex-col gap-1 px-2 py-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded bg-sidebar-accent"
              />
            ))}
          </div>
        ) : visible.length === 0 ? (
          trimmedQuery !== "" ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {/* Never claim no-match over a half-loaded set. */}
              {status === "live"
                ? `No matches for “${trimmedQuery}”`
                : "Loading library…"}
            </p>
          ) : (
            <div className="px-2 py-6 text-center">
              <p className="text-xs text-muted-foreground">No stories yet.</p>
              <NewStoryButton variant="outline" size="xs" className="mt-3" />
            </div>
          )
        ) : (
          <>
            <SidebarMenu>
              {visible.map((story) => (
                <StoryListItem
                  key={story.id}
                  story={story}
                  run={runStatus(story.id)}
                />
              ))}
            </SidebarMenu>
            {filtered.length > visible.length ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="mt-1 w-full text-muted-foreground"
                onClick={() => setVisibleCount((c) => c + WINDOW)}
              >
                Load more
              </Button>
            ) : null}
          </>
        )}
        {/* The honest affordance: these edits are applied but not yet durable. */}
        {depth > 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">Saving…</p>
        ) : null}
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
