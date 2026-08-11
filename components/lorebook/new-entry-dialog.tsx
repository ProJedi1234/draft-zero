"use client"

import { useState, useTransition } from "react"
import { Loader2, Plus } from "lucide-react"
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
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { createLorebookEntry } from "@/lib/actions/lorebook"
import type { NewLorebookEntry } from "@/lib/types"

import {
  EMPTY_LOREBOOK_DRAFT,
  LorebookEntryEditor,
} from "@/components/lorebook/lorebook-entry-editor"

export function NewEntryDialog({
  onCreated,
}: {
  /** Fired after a successful create so the view can select the new entry. */
  onCreated?: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<NewLorebookEntry>(EMPTY_LOREBOOK_DRAFT)
  // Bumped on every open so the editor remounts with a blank draft.
  const [formKey, setFormKey] = useState(0)
  const [isPending, startTransition] = useTransition()

  const canCreate = draft.name.trim() !== "" && !isPending

  function handleOpenChange(next: boolean) {
    if (next) {
      setDraft(EMPTY_LOREBOOK_DRAFT)
      setFormKey((k) => k + 1)
    }
    setOpen(next)
  }

  function handleCreate() {
    if (draft.name.trim() === "") return
    startTransition(async () => {
      const res = await createLorebookEntry({
        ...draft,
        name: draft.name.trim(),
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setOpen(false)
      toast.success("Entry created")
      onCreated?.(res.data.id)
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus data-icon="inline-start" />
        New entry
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New lorebook entry</DialogTitle>
          <DialogDescription>
            Define a person, place, or idea the model should remember.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60svh] pr-3">
          <LorebookEntryEditor
            key={formKey}
            layout="dialog"
            onChange={setDraft}
          />
        </ScrollArea>
        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            }
          />
          <Button size="sm" disabled={!canCreate} onClick={handleCreate}>
            {isPending && (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            )}
            Create entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
