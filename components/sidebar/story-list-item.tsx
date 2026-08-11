"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Copy, Loader2, MoreHorizontal, PencilLine, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { duplicateStory } from "@/lib/actions/stories"
import type { StorySummary } from "@/lib/types"
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
import { DeleteStoryDialog } from "@/components/sidebar/delete-story-dialog"
import { RenameStoryDialog } from "@/components/sidebar/rename-story-dialog"

type PendingDialog = "rename" | "delete" | null

export function StoryListItem({ story }: { story: StorySummary }) {
  const pathname = usePathname()
  const router = useRouter()
  const isActive = pathname === `/story/${story.id}`

  const [menuOpen, setMenuOpen] = React.useState(false)
  // Dialogs open only once the menu has finished closing, so the menu's
  // focus restoration never fights the dialog's focus trap.
  const [queuedDialog, setQueuedDialog] = React.useState<PendingDialog>(null)
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  function handleMenuClosed(open: boolean) {
    if (open || queuedDialog === null) return
    if (queuedDialog === "rename") setRenameOpen(true)
    if (queuedDialog === "delete") setDeleteOpen(true)
    setQueuedDialog(null)
  }

  function handleDuplicate() {
    startTransition(async () => {
      const res = await duplicateStory(story.id)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success("Story duplicated")
      router.push(`/story/${res.data.id}`)
    })
  }

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
            {story.genre ? `${story.genre} · ` : ""}
            {formatRelativeDate(story.updatedAt)}
          </span>
        </div>
      </SidebarMenuButton>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onOpenChangeComplete={handleMenuClosed}
      >
        <DropdownMenuTrigger
          render={<SidebarMenuAction showOnHover aria-label="Story actions" />}
        >
          {isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <MoreHorizontal />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem
            disabled={isPending}
            onClick={() => setQueuedDialog("rename")}
          >
            <PencilLine />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isPending} onClick={handleDuplicate}>
            <Copy />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={isPending}
            onClick={() => setQueuedDialog("delete")}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameStoryDialog
        storyId={story.id}
        currentTitle={story.title}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <DeleteStoryDialog
        storyId={story.id}
        title={story.title}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </SidebarMenuItem>
  )
}
