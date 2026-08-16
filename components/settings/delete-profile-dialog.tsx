"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

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
import { deleteProfile } from "@/lib/actions/profiles"
import type { ModelProfile } from "@/lib/types"

/**
 * Confirms a delete, and says what happens to the stories on it: they become
 * Custom with the settings they were already generating under, so nothing
 * about their output changes — they just stop tracking anything.
 */
export function DeleteProfileDialog({
  profile,
  followerCount,
  open,
  onOpenChange,
}: {
  profile: ModelProfile
  followerCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [isPending, startTransition] = React.useTransition()

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteProfile(profile.id)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success("Profile deleted")
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete profile</DialogTitle>
          <DialogDescription>
            Delete “{profile.name}”?{" "}
            {followerCount > 0
              ? `${followerCount} ${
                  followerCount === 1 ? "story goes" : "stories go"
                } Custom, keeping these settings.`
              : "No stories follow it."}
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
