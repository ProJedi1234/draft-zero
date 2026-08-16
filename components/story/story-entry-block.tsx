"use client"

import * as React from "react"
import { Loader2, Pencil, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { deleteEntry } from "@/lib/actions/entries"
import type { StoryEntry } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
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
import { EntryContextButton } from "@/components/context/entry-context-button"
import { EntryCostChip } from "@/components/cost/entry-cost-chip"
import { PassageEditor } from "@/components/story/passage-editor"
import { Prose } from "@/components/story/prose"
import { VariantSwitcher } from "@/components/story/variant-switcher"

/**
 * Memoised: a generation pushes ~40 chunk updates through the canvas in about a
 * second, and none of these props change while it streams. Without this every
 * persisted passage (each carrying three Tooltip roots and a Dialog root, plus
 * the switcher's three once a slot has more than one take) re-renders on every
 * chunk. `isLast` and `onRetry` are both stable for the same reason: only the
 * final block ever sees `isLast` flip, and `onRetry` needs no entry id because
 * the only retryable passage is that last one.
 */
export const StoryEntryBlock = React.memo(function StoryEntryBlock({
  entry,
  storyId,
  busy,
  isLast,
  onRetry,
}: {
  entry: StoryEntry
  storyId: string
  busy: boolean
  /** Last block in the manuscript — the only one that may be regenerated. */
  isLast: boolean
  onRetry: () => void
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
      // A player turn opens an editor seeded with the writer's first-person
      // input, not the passage, so the label has to say which one it is —
      // the same branch the editor's own label makes.
      label:
        entry.actionKind === null || entry.inputText === null
          ? "Edit passage"
          : `Edit your ${entry.actionKind === "say" ? "Say" : "Do"}`,
      onClick: () => setEditing(true),
    },
    // Only the last generated passage can be retried, because the story never
    // branches: regenerating anything earlier would have to decide what happens
    // to the prose written after it, and every answer to that is a branch. A
    // retry now keeps the old take beside the new one in the same slot, so the
    // label is a plain "Retry" — nothing is thrown away and nothing "from here"
    // is removed.
    ...(isLast && entry.source === "generated"
      ? [
          {
            key: "retry",
            icon: RefreshCw,
            label: "Retry",
            onClick: onRetry,
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
          entry={entry}
          onDone={() => setEditing(false)}
        />
      ) : (
        <Prose text={entry.text} />
      )}

      {/* Hidden while the editor is open: the switcher would swap the prose out
          from under a half-written edit, and the editor's buffer is seeded once
          and never resynced from props. */}
      {/* Only the last block, for the same reason only the last block can be
          regenerated: an earlier passage is settled, and everything after it
          was written against the take that is showing. Swapping one out from
          under that prose would leave the story following from something it no
          longer says. Earlier takes are not lost — they are still on disk, and
          undo still walks back through the retry that made them — they just
          stop being a control on a block the story has already built on. */}
      {!editing && isLast && entry.variantCount > 1 && (
        <VariantSwitcher entry={entry} storyId={storyId} disabled={locked} />
      )}

      {/* Revealed on hover, but never `display: none` — the same pattern as
          SidebarMenuAction, so the buttons stay in the tab order for keyboard
          users and are permanently visible on touch (no hover to give). */}
      <div className="absolute -top-3 right-2 flex items-center gap-0.5 border bg-background p-0.5 shadow-sm transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 md:pointer-events-none md:opacity-0">
        {/* Rides the cluster's own reveal — no second hover target. A generated
            passage only; what a typed one cost is not a question, and a dash
            there would read as a broken value. Below `md` the cluster has no
            hover to hide behind, so the chip shows a "$" glyph rather than a
            figure: an amount permanently printed under every passage is the one
            thing this feature promises never to do. */}
        {entry.source === "generated" && (
          <>
            <EntryCostChip entry={entry} />
            {/* Beside the cost, because they answer the two questions a
                finished passage raises — what it cost, and what it was told. */}
            <EntryContextButton storyId={storyId} entryId={entry.id} />
            <Separator orientation="vertical" className="mx-0.5 h-4" />
          </>
        )}
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
            {/* Delete is a soft delete that records an op, so ⌘Z genuinely
                brings the passage back — the copy has to say so. Telling the
                writer the opposite is worse than saying nothing: it makes them
                hesitate over a reversible action and, if they believe it, stops
                them reaching for the undo that would fix a mistake. */}
            <DialogDescription>
              The passage leaves the story. You can bring it back with undo.
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
