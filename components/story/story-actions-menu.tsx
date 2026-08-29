"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Copy, Loader2, MoreHorizontal, PencilLine, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { duplicateStoryOptimistic } from "@/lib/store/story-mutations"
import type { StorySummary } from "@/lib/types"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useSidebar } from "@/components/ui/sidebar"
import { DeleteStoryDialog } from "@/components/sidebar/delete-story-dialog"
import { StoryDetailsDialog } from "@/components/story/story-details-dialog"

type PendingDialog = "details" | "delete" | null

/**
 * Edit details / Duplicate / Delete, and the two dialogs behind them.
 *
 * Shared by the sidebar row and the library card, which have almost no chrome
 * in common — one is built from sidebar primitives and carries a run mark and
 * a running clock, the other is a static card with a word count. What they do
 * share is this: the same three actions and the same fiddly orchestration
 * around them. So the menu travels and the rows stay separate; each call site
 * passes the trigger its own layout wants.
 */
export function StoryActionsMenu({
  story,
  trigger,
  side = "bottom",
  align = "end",
  closeOnSidebarCollapse = false,
  navigateOnDuplicate = false,
}: {
  story: StorySummary
  /** Rendered as the kebab. Receives the icon — spinner while an action runs. */
  trigger: React.ReactElement
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  /**
   * Sidebar-only. The menu is portalled and tracks its anchor, so a rail
   * sliding offcanvas — ⌘B, the trigger, focus mode — would leave it behind,
   * shifted back into the viewport as a modal menu over the manuscript. The
   * library does not move when the rail does, and closing its menu on ⌘B would
   * just be a surprise.
   */
  closeOnSidebarCollapse?: boolean
  /** Follow the copy, rather than staying where you are and watching it arrive. */
  navigateOnDuplicate?: boolean
}) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = React.useState(false)
  // Dialogs open only once the menu has finished closing, so the menu's
  // focus restoration never fights the dialog's focus trap.
  const [queuedDialog, setQueuedDialog] = React.useState<PendingDialog>(null)
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  // Unconditional: the provider lives in the root layout, so this reads on
  // every page. Adjusted during render rather than in an effect, like the
  // mobile sheet's route close — the menu would otherwise be visibly orphaned
  // for one committed frame.
  const { state: sidebarState } = useSidebar()
  const [lastSidebarState, setLastSidebarState] = React.useState(sidebarState)
  if (sidebarState !== lastSidebarState) {
    setLastSidebarState(sidebarState)
    if (closeOnSidebarCollapse && sidebarState === "collapsed")
      setMenuOpen(false)
  }

  function handleMenuClosed(open: boolean) {
    if (open || queuedDialog === null) return
    if (queuedDialog === "details") setDetailsOpen(true)
    if (queuedDialog === "delete") setDeleteOpen(true)
    setQueuedDialog(null)
  }

  function handleDuplicate() {
    startTransition(async () => {
      // seed is StorySummary-shaped; duplicateStoryOptimistic only reads the
      // fields below, but id/createdAt/updatedAt are required by the type.
      const res = await duplicateStoryOptimistic(story.id, {
        id: story.id,
        title: story.title,
        description: story.description,
        genre: story.genre,
        createdAt: story.createdAt,
        updatedAt: story.updatedAt,
        tintHue: story.tintHue,
        tintStrength: story.tintStrength,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success("Story duplicated")
      if (navigateOnDuplicate) router.push(`/story/${res.data.id}`)
    })
  }

  return (
    <>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onOpenChangeComplete={handleMenuClosed}
      >
        <DropdownMenuTrigger render={trigger}>
          {isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <MoreHorizontal />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent side={side} align={align}>
          <DropdownMenuItem
            disabled={isPending}
            onClick={() => setQueuedDialog("details")}
          >
            <PencilLine />
            Edit details
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
      <StoryDetailsDialog
        storyId={story.id}
        title={story.title}
        description={story.description}
        genre={story.genre}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
      <DeleteStoryDialog
        storyId={story.id}
        title={story.title}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  )
}
