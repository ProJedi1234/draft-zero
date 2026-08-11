"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { renameStory } from "@/lib/actions/stories"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function RenameStoryDialog({
  storyId,
  currentTitle,
  open,
  onOpenChange,
}: {
  storyId: string
  currentTitle: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename story</DialogTitle>
          <DialogDescription>
            Give this story a new title. It appears in the library and the story
            header.
          </DialogDescription>
        </DialogHeader>
        {/* Keyed by story id: the field initializes from the server value once
            per story and is never resynced from props while open (§4.2). */}
        <RenameStoryForm
          key={storyId}
          storyId={storyId}
          currentTitle={currentTitle}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function RenameStoryForm({
  storyId,
  currentTitle,
  onDone,
}: {
  storyId: string
  currentTitle: string
  onDone: () => void
}) {
  const [value, setValue] = React.useState(currentTitle)
  const [isPending, startTransition] = React.useTransition()
  const trimmed = value.trim()

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (trimmed === "" || isPending) return
    startTransition(async () => {
      const res = await renameStory(storyId, trimmed)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="rename-story-title">Title</Label>
        <Input
          id="rename-story-title"
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Untitled Story"
          disabled={isPending}
        />
      </div>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={trimmed === "" || isPending}>
          {isPending ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : null}
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}
