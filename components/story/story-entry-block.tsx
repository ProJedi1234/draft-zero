"use client"

import * as React from "react"
import { Loader2, Pencil, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { deleteEntry } from "@/lib/actions/entries"
import type { StoryEntry } from "@/lib/types"
import { cn } from "@/lib/utils"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { PassageEditor } from "@/components/story/passage-editor"
import { Prose } from "@/components/story/prose"

/**
 * Memoised: a generation pushes ~40 chunk updates through the canvas in about a
 * second, and none of these props change while it streams. Without this every
 * persisted passage (each carrying three Tooltip roots and a Dialog root)
 * re-renders on every chunk.
 */
export const StoryEntryBlock = React.memo(function StoryEntryBlock({
  entry,
  storyId,
  busy,
  onRetryFrom,
}: {
  entry: StoryEntry
  storyId: string
  busy: boolean
  onRetryFrom: (entryId: string) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [isDeleting, startDeleting] = React.useTransition()

  const locked = busy || editing || isDeleting

  function handleDelete() {
    startDeleting(async () => {
      const res = await deleteEntry(storyId, entry.id)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      // Silent on success (§4.6) — the block vanishing is the confirmation.
      setConfirmOpen(false)
    })
  }

  const actions = [
    {
      key: "edit",
      icon: Pencil,
      label: "Edit passage",
      onClick: () => setEditing(true),
    },
    ...(entry.source === "generated"
      ? [
          {
            key: "retry",
            icon: RefreshCw,
            label: "Retry from here",
            onClick: () => onRetryFrom(entry.id),
          },
        ]
      : []),
    {
      key: "delete",
      icon: Trash2,
      label: "Delete passage",
      onClick: () => setConfirmOpen(true),
    },
  ]

  return (
    <div
      data-source={entry.source}
      className={cn(
        "group relative -mx-4 px-4 py-3 transition-colors",
        entry.source === "user" && "border-l-2 border-primary/40",
        editing ? "bg-muted/40" : "hover:bg-muted/40"
      )}
    >
      {editing ? (
        <PassageEditor
          key={entry.id}
          storyId={storyId}
          entryId={entry.id}
          initialText={entry.text}
          onDone={() => setEditing(false)}
        />
      ) : (
        <Prose text={entry.text} />
      )}

      {/* Revealed on hover, but never `display: none` — the same pattern as
          SidebarMenuAction, so the buttons stay in the tab order for keyboard
          users and are permanently visible on touch (no hover to give). */}
      <div className="absolute -top-3 right-2 flex items-center gap-0.5 border bg-background p-0.5 shadow-sm transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 md:pointer-events-none md:opacity-0">
        {actions.map(({ key, icon: Icon, label, onClick }) => (
          <Tooltip key={key}>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={label}
                  onClick={onClick}
                  disabled={locked}
                />
              }
            >
              <Icon />
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this passage?</DialogTitle>
            <DialogDescription>
              The passage is removed from the story. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={
                <Button variant="outline" size="sm" disabled={isDeleting}>
                  Cancel
                </Button>
              }
            />
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting && (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
})
