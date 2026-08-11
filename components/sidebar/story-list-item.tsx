"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Copy, MoreHorizontal, PencilLine, Trash2 } from "lucide-react"

import type { Story } from "@/lib/types"
import { formatRelativeDate } from "@/lib/format"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function StoryListItem({ story }: { story: Story }) {
  const pathname = usePathname()
  const isActive = pathname === `/story/${story.id}`

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        className="h-auto py-2"
        render={<Link href={`/story/${story.id}`} />}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{story.title}</span>
          <span className="truncate text-xs text-muted-foreground">
            {story.genre} · {formatRelativeDate(story.updatedAt)}
          </span>
        </div>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<SidebarMenuAction showOnHover aria-label="Story actions" />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem>
            <PencilLine />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Copy />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}
