"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { updateStoryMeta } from "@/lib/actions/stories"
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/generation/system-prompt"
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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/**
 * The story's narrator prompt, as a dialog.
 *
 * It was a collapsible holding a 48-row monospace textarea inside a 320px
 * column, rendered against the built-in prompt as placeholder — which at that
 * width could not be read, so the one thing the field exists to be compared
 * against was illegible. Here it gets a measure wide enough to judge it by.
 *
 * Empty means "no override": the column stores NULL and the story keeps
 * following DEFAULT_SYSTEM_PROMPT as it changes, rather than freezing a copy
 * of today's text. updateStoryMeta is what enforces that; clearing the box and
 * saving is the way back.
 */
export function NarratorDialog({
  storyId,
  systemPrompt,
  open,
  onOpenChange,
}: {
  storyId: string
  /** The story's override, or null when it follows the built-in prompt. */
  systemPrompt: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent sheet className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Narrator</DialogTitle>
          <DialogDescription>
            How the model is told to write. Leave it empty to use the built-in
            prompt, shown greyed out below.
          </DialogDescription>
        </DialogHeader>
        {/* Keyed by story id: the field initializes from the server value once
            per story and is never resynced from props while open (§4.2). */}
        <NarratorForm
          key={storyId}
          storyId={storyId}
          systemPrompt={systemPrompt}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function NarratorForm({
  storyId,
  systemPrompt,
  onDone,
}: {
  storyId: string
  systemPrompt: string | null
  onDone: () => void
}) {
  const uid = React.useId()
  // "" is the honest rendering of a null override: the field shows the built-in
  // prompt as placeholder text, and saving it blank stores NULL again.
  const [value, setValue] = React.useState(systemPrompt ?? "")
  const [isPending, startTransition] = React.useTransition()
  const isOverridden = value.trim() !== ""

  function handleSave() {
    if (isPending) return
    startTransition(async () => {
      const res = await updateStoryMeta(storyId, { systemPrompt: value })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      onDone()
    })
  }

  return (
    <>
      <DialogBody className="sm:max-h-[60svh]">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${uid}-system-prompt`} className="sr-only">
            Narrator prompt
          </Label>
          <Textarea
            id={`${uid}-system-prompt`}
            value={value}
            className="min-h-64 font-mono text-xs max-sm:min-h-full"
            // The built-in prompt as placeholder: it is what actually runs when
            // the field is empty, so it belongs in the box, greyed out.
            placeholder={DEFAULT_SYSTEM_PROMPT}
            disabled={isPending}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
      </DialogBody>
      <DialogFooter className="sm:justify-between">
        {/* Only when there is something to revert — an always-present reset on
            a story already following the built-in prompt is a button that
            does nothing, next to the text it claims to restore. */}
        {isOverridden ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => setValue("")}
          >
            Use built-in
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <DialogClose render={<Button variant="outline" size="sm" />}>
            Cancel
          </DialogClose>
          <Button size="sm" disabled={isPending} onClick={handleSave}>
            {isPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : null}
            Save
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
