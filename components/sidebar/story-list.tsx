"use client"

import * as React from "react"
import { Loader2, Plus } from "lucide-react"

import type { StorySummary } from "@/lib/types"
import type { RunStatus } from "@/hooks/use-run-status"
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

/** Case-insensitive substring match over title, genre and description. */
function matchesQuery(story: StorySummary, needle: string): boolean {
  return (
    story.title.toLowerCase().includes(needle) ||
    story.genre.toLowerCase().includes(needle) ||
    story.description.toLowerCase().includes(needle)
  )
}

export function StoryList({
  stories,
  query,
  runStatus,
}: {
  stories: StorySummary[]
  query: string
  /** What each story is doing — see hooks/use-run-status.ts. */
  runStatus: (storyId: string) => RunStatus
}) {
  const { createNewStory, isPending } = useCreateStory()
  const trimmedQuery = query.trim()

  // Server order is updatedAt DESC — filter only, never re-sort.
  const filtered = React.useMemo(() => {
    if (trimmedQuery === "") return stories
    const needle = trimmedQuery.toLowerCase()
    return stories.filter((story) => matchesQuery(story, needle))
  }, [stories, trimmedQuery])

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
        {stories.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <p className="text-xs text-muted-foreground">No stories yet.</p>
            <NewStoryButton variant="outline" size="xs" className="mt-3" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No matches for “{trimmedQuery}”
          </p>
        ) : (
          <SidebarMenu>
            {filtered.map((story) => (
              <StoryListItem
                key={story.id}
                story={story}
                run={runStatus(story.id)}
              />
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
