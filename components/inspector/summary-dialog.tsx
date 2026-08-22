"use client"

import * as React from "react"
import { toast } from "sonner"

import { useServerSyncedValue } from "@/hooks/use-server-synced"
import { updateStoryMeta } from "@/lib/actions/stories"
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
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

/**
 * The story's rolling summary, as a dialog.
 *
 * Read-only, and that is the design rather than an omission: the text is
 * machine-maintained and is rewritten every time the window slides, so anything
 * typed here would survive until the next passage and no longer. The place for
 * a fact the summarizer keeps dropping is Memory, which is never overwritten —
 * and the copy below says so, because otherwise the obvious move is to correct
 * the summary and watch the correction vanish.
 *
 * There is no regenerate button. Rebuilding means re-reading the whole
 * manuscript from page one, which is dozens of sequential calls on a long
 * story, and the feature deliberately never walks backward.
 */
export function SummaryDialog({
  storyId,
  summary,
  summarize,
  open,
  onOpenChange,
}: {
  storyId: string
  /** The version currently in force, or "" when there is none yet. */
  summary: string
  /** Whether new versions are written as the window slides. */
  summarize: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const uid = React.useId()
  // Follows the server while mounted — another device can switch this — but
  // never while this device's own write is still in flight. Optimistic in the
  // meantime: the switch is the whole point of the dialog and must not wait a
  // round trip to move. See hooks/use-server-synced.ts.
  const auto = useServerSyncedValue(summarize)
  const enabled = auto.value
  const [, startTransition] = React.useTransition()

  function handleToggle(next: boolean) {
    const previous = enabled
    auto.write(next)
    startTransition(async () => {
      let ok = false
      let message = "Couldn't save that."
      try {
        const result = await updateStoryMeta(storyId, { summarize: next })
        ok = result.ok
        if (!result.ok) message = result.error
      } catch (error) {
        message =
          error instanceof Error && error.message ? error.message : message
      }
      if (ok) {
        auto.settle()
      } else {
        auto.reset(previous)
        toast.error(message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent sheet className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Story so far</DialogTitle>
          <DialogDescription>
            Once a story outgrows its context window, its opening stops being
            sent to the model. This is the recap that goes in its place.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-1">
              <Label htmlFor={`${uid}-auto`}>Keep it up to date</Label>
              <p className="text-xs text-muted-foreground">
                Rewrites the recap as older passages fall out of context. Switch
                it off and the recap freezes where it is — it carries on being
                sent, it just stops costing anything.
              </p>
            </div>
            <Switch
              id={`${uid}-auto`}
              checked={enabled}
              onCheckedChange={handleToggle}
            />
          </div>

          <div className="space-y-2">
            <Label>Current recap</Label>
            {summary === "" ? (
              <p className="border border-dashed p-4 text-sm text-muted-foreground">
                Nothing yet. This story still fits its context window, so the
                model can see all of it and there is nothing to stand in for.
              </p>
            ) : (
              <p className="max-h-80 overflow-y-auto border p-4 font-serif text-[0.9375rem] leading-7 whitespace-pre-wrap">
                {summary}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Written by the model, and rewritten each time the window slides —
              so editing it here would not last. A fact it keeps losing belongs
              in Memory, which is yours and never overwritten.
            </p>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Close</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
