"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { deleteStoryOptimistic } from "@/lib/store/story-mutations"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function DeleteStoryDialog({
  storyId,
  title,
  open,
  onOpenChange,
}: {
  storyId: string
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = React.useTransition()

  function handleDelete() {
    startTransition(async () => {
      // The row's removal is optimistic, but navigation is not reversible by
      // dropping an overlay entry: a rejected delete has to leave the writer
      // exactly where they were, row restored — so navigation and the success
      // toast wait for confirm.
      const wasOpen = pathname === `/story/${storyId}`
      onOpenChange(false)
      const res = await deleteStoryOptimistic(storyId)
      if (res.ok) {
        toast.success("Story deleted")
        if (wasOpen) router.push("/")
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete story</DialogTitle>
          <DialogDescription>
            Delete “{title}”? This permanently removes the story and all its
            passages.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            onClick={handleDelete}
          >
            {isPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : null}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
