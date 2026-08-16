"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
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
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { saveStoryAsProfile } from "@/lib/actions/profiles"

const FALLBACK_ERROR = "Couldn't save the profile."

/**
 * Promotes the settings a writer dialled in on one story into a named profile —
 * the end of a successful experiment. Only a name is asked for: the settings are
 * already on the story, and the action reads them there rather than trusting a
 * second copy travelling up from the client.
 *
 * The story starts following the new profile, so the caller has to move its
 * switcher to the returned id.
 */
export function SaveProfileDialog({
  storyId,
  open,
  onOpenChange,
  onSaved,
}: {
  storyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (profileId: string) => void
}) {
  const [name, setName] = React.useState("")
  const [isPending, startTransition] = React.useTransition()
  const trimmed = name.trim()

  function handleSave() {
    if (trimmed === "" || isPending) return
    startTransition(async () => {
      try {
        const result = await saveStoryAsProfile(storyId, trimmed)
        if (!result.ok) {
          toast.error(result.error)
          return
        }
        onSaved(result.data.id)
        toast.success(`This story now follows ${trimmed}`)
        setName("")
        onOpenChange(false)
      } catch (error) {
        // A thrown action — a dropped connection mid-save — never reaches the
        // `ok` check above.
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : FALLBACK_ERROR
        )
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent sheet className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Save as profile</DialogTitle>
          <DialogDescription>
            Keeps this story&apos;s settings as a named profile. The story
            follows it from now on, and so can any other.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-2">
            <Label htmlFor="save-profile-name">Name</Label>
            <Input
              id="save-profile-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleSave()
              }}
              placeholder="Quality"
              disabled={isPending}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose
            render={<Button type="button" variant="outline" size="sm" />}
          >
            Cancel
          </DialogClose>
          <Button
            type="button"
            size="sm"
            disabled={trimmed === "" || isPending}
            onClick={handleSave}
          >
            {isPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
