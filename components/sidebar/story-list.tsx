"use client"

import { Plus } from "lucide-react"

import type { Story } from "@/lib/types"
import { Button } from "@/components/ui/button"
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@/components/ui/sidebar"
import { StoryListItem } from "@/components/sidebar/story-list-item"

export function StoryList({ stories }: { stories: Story[] }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Library</SidebarGroupLabel>
      <SidebarGroupAction title="New story">
        <Plus />
        <span className="sr-only">New story</span>
      </SidebarGroupAction>
      <SidebarGroupContent>
        {stories.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <p className="text-xs text-muted-foreground">No stories yet.</p>
            <Button variant="outline" size="xs" className="mt-3">
              <Plus data-icon="inline-start" />
              New story
            </Button>
          </div>
        ) : (
          <SidebarMenu>
            {stories.map((story) => (
              <StoryListItem key={story.id} story={story} />
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
