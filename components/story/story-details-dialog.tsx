"use client"

import * as React from "react"
import { toast } from "sonner"

import { updateStoryMetaOptimistic } from "@/lib/store/story-mutations"
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
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/**
 * Title, description and genre — everything about a story that is *library*
 * metadata rather than something the model reads.
 *
 * These lived in the inspector, which put three fields you set once at creation
 * above the two you reach for mid-paragraph, and left the title writable from
 * two places at once (this dialog used to be Rename, and edited the same
 * column). A dialog is the right shape for a field you touch once: the panel
 * gets the space back, and the fields get a width they can actually be read at.
 *
 * Explicit Save rather than the inspector's autosave, which is the convention
 * every other dialog in the app already follows — a dialog you can cancel has
 * to have something to cancel.
 */
export function StoryDetailsDialog({
  storyId,
  title,
  description,
  genre,
  open,
  onOpenChange,
}: {
  storyId: string
  title: string
  description: string
  genre: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent sheet className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Story details</DialogTitle>
          <DialogDescription>
            How this story appears in the library. None of this is sent to the
            model.
          </DialogDescription>
        </DialogHeader>
        {/* Keyed by story id: the fields initialize from the server value once
            per story and are never resynced from props while open (§4.2). */}
        <StoryDetailsForm
          key={storyId}
          storyId={storyId}
          title={title}
          description={description}
          genre={genre}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function StoryDetailsForm({
  storyId,
  title,
  description,
  genre,
  onDone,
}: {
  storyId: string
  title: string
  description: string
  genre: string
  onDone: () => void
}) {
  const uid = React.useId()
  const [draft, setDraft] = React.useState({ title, description, genre })
  const trimmedTitle = draft.title.trim()
  const canSave = trimmedTitle !== ""

  function handleSave() {
    if (!canSave) return
    // The write is optimistic — the sidebar's saving line and a failure toast
    // are the signals, not a spinner on this button.
    void updateStoryMetaOptimistic(storyId, {
      title: draft.title,
      description: draft.description,
      genre: draft.genre,
    }).then((res) => {
      if (!res.ok) toast.error(res.error)
    })
    onDone()
  }

  return (
    <>
      <DialogBody className="sm:max-h-[60svh]">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${uid}-title`}>Title</Label>
            {/* The only single-line field in the app that needs a form owner.
                iOS substring-matches a field's strings against contact fields,
                and "Untitled Story" contains "title" — organization-title, the
                job-title field — which raises the AutoFill Contact bar. The
                form owner suppresses it; renaming the id does not, since the
                placeholder alone is enough to trip it. Same mechanism as
                <Textarea>, documented there. */}
            <form className="contents" onSubmit={(e) => e.preventDefault()}>
              <Input
                id={`${uid}-title`}
                value={draft.title}
                placeholder="Untitled Story"
                aria-invalid={trimmedTitle === "" || undefined}
                onChange={(event) =>
                  setDraft((d) => ({ ...d, title: event.target.value }))
                }
                // The one field where Enter still means "save" — renaming was a
                // one-field form before this dialog grew, and losing the keystroke
                // would make the commonest edit here slower than it was.
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return
                  event.preventDefault()
                  handleSave()
                }}
              />
            </form>
            <p className="text-xs text-muted-foreground">
              {trimmedTitle === ""
                ? "A title is required."
                : "Shown in the library and the story header."}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${uid}-description`}>Description</Label>
            <Textarea
              id={`${uid}-description`}
              value={draft.description}
              className="min-h-16"
              placeholder="A sentence or two about this story…"
              onChange={(event) =>
                setDraft((d) => ({ ...d, description: event.target.value }))
              }
            />
            <p className="text-xs text-muted-foreground">
              The pitch shown beside the story in the library.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${uid}-genre`}>Genre</Label>
            <Input
              id={`${uid}-genre`}
              value={draft.genre}
              placeholder="Literary fiction"
              onChange={(event) =>
                setDraft((d) => ({ ...d, genre: event.target.value }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Used for the library badge and search.
            </p>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" size="sm" />}>
          Cancel
        </DialogClose>
        <Button size="sm" disabled={!canSave} onClick={handleSave}>
          Save
        </Button>
      </DialogFooter>
    </>
  )
}
