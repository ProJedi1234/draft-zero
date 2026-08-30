"use client"

import { useState, useTransition } from "react"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { startLorebookCreate } from "@/lib/store/lorebook-mutations"
import type { NewLorebookEntry } from "@/lib/types"

import {
  EMPTY_LOREBOOK_DRAFT,
  LorebookEntryEditor,
} from "@/components/lorebook/lorebook-entry-editor"

export function NewEntryDialog({
  storyId,
  onCreated,
}: {
  /** The story the new entry belongs to. */
  storyId: string
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

    // The id is available synchronously and the row is in the store before this
    // returns, so the dialog closes into a real editor rather than waiting on
    // the insert. `settled` is only interesting for the error toast.
    const { id, settled } = startLorebookCreate(storyId, {
      ...draft,
      name: draft.name.trim(),
    })
    setOpen(false)
    onCreated?.(id)

    startTransition(async () => {
      const res = await settled
      // The overlay is already gone — the queue rolled it back — so this is
      // telling the writer why the entry they were just editing vanished.
      if (!res.ok) toast.error(res.error)
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* Icon-only on a phone: the full-width label crowds the story title out
          of a 390px header entirely. */}
      <DialogTrigger
        render={<Button size="sm" aria-label="New entry" />}
        className="max-sm:size-9 max-sm:px-0"
      >
        <Plus data-icon="inline-start" />
        <span className="max-sm:hidden">New entry</span>
      </DialogTrigger>
      <DialogContent sheet className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New lorebook entry</DialogTitle>
          <DialogDescription>
            Define a person, place, or idea the model should remember.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="sm:max-h-[60svh]">
          <LorebookEntryEditor
            key={formKey}
            layout="dialog"
            onChange={setDraft}
          />
        </DialogBody>
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
