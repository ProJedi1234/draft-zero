"use client"

import * as React from "react"
import {
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"

import { deleteEntry, rewindToEntry } from "@/lib/actions/entries"
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
import { RetryButton } from "@/components/story/retry-profile-menu"
import { VariantSwitcher } from "@/components/story/variant-switcher"

/**
 * Memoised: a generation pushes ~40 chunk updates through the canvas in about a
 * second, and none of these props change while it streams. Without this every
 * persisted passage (each carrying three Tooltip roots and a Dialog root, plus
 * the switcher's three once a slot has more than one take) re-renders on every
 * chunk. `followingCount` holds still through a stream for the same reason the
 * rest do — the persisted entries do not change until the turn settles — and
 * `onRetry` needs no entry id because the only retryable passage is the last.
 */
export const StoryEntryBlock = React.memo(function StoryEntryBlock({
  entry,
  storyId,
  busy,
  followingCount,
  onRetry,
}: {
  entry: StoryEntry
  storyId: string
  busy: boolean
  /**
   * How many passages the manuscript shows after this one. A count rather than
   * an `isLast` flag because both things hanging off it need the number: zero
   * means this is the last block, the only one that may be regenerated, and any
   * other value is what a rewind here would set aside.
   */
  followingCount: number
  onRetry: () => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [rewindOpen, setRewindOpen] = React.useState(false)
  const [isDeleting, startDeleting] = React.useTransition()
  const [isRewinding, startRewinding] = React.useTransition()

  const isLast = followingCount === 0
  const locked = busy || editing || isDeleting || isRewinding

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

  function handleRewind() {
    startRewinding(async () => {
      const res = await rewindToEntry(storyId, entry.id)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      // Silent for the same reason as delete, and more so: the manuscript
      // ending here is a larger confirmation than any toast.
      setRewindOpen(false)
    })
  }

  // A player turn opens an editor seeded with the writer's first-person input,
  // not the passage, so the label has to say which one it is — the same branch
  // the editor's own label makes.
  const editLabel =
    entry.actionKind === null || entry.inputText === null
      ? "Edit passage"
      : `Edit your ${entry.actionKind === "say" ? "Say" : "Do"}`

  return (
    <div
      data-source={entry.source}
      className={cn(
        "group relative -mx-4 px-4 py-3 transition-colors",
        entry.source === "user" && "border-l-2 border-story-accent",
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
        <ClusterButton
          icon={Pencil}
          label={editLabel}
          disabled={locked}
          onClick={() => setEditing(true)}
        />

        {isLast ? (
          // Only the last generated passage can be retried, because the story
          // never branches: regenerating anything earlier would have to decide
          // what happens to the prose written after it, and every answer to
          // that is a branch. A retry keeps the old take beside the new one in
          // the same slot, so the label is a plain "Retry" — nothing is thrown
          // away and nothing "from here" is removed. The caret beside it asks
          // the second question a disliked passage raises: not "again?" but
          // "who else?".
          entry.source === "generated" && (
            <RetryButton
              icon={RefreshCw}
              label="Retry"
              size="xs"
              disabled={locked}
              onRetry={onRetry}
            />
          )
        ) : (
          // Where the writer ends the story, not where they restart it: the
          // passages after this one are set aside, nothing is regenerated, and
          // one ⌘Z brings the whole tail back — which is why the glyph is
          // undo's and not a scissors or a trash can. Never on the last block,
          // where it would offer to remove nothing, so it and Retry are
          // mutually exclusive and the cluster stays three buttons wide.
          <ClusterButton
            icon={Undo2}
            label="Rewind to here"
            disabled={locked}
            onClick={() => setRewindOpen(true)}
          />
        )}

        <ClusterButton
          icon={Trash2}
          label="Delete passage"
          disabled={locked}
          onClick={() => setConfirmOpen(true)}
        />
      </div>

      <Dialog open={rewindOpen} onOpenChange={setRewindOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rewind to here?</DialogTitle>
            {/* The count is the whole point of the sentence: the passages this
                takes are the ones scrolled off the bottom of the screen, so it
                is the one removal the writer cannot see the size of. Same undo
                promise as Delete, and it is one step, not one per passage. */}
            <DialogDescription>
              {followingCount === 1
                ? "The passage after this one leaves the story."
                : `The ${followingCount} passages after this one leave the story.`}{" "}
              This passage stays, and undo brings the rest back in one step.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={
                <Button variant="outline" size="sm" disabled={isRewinding}>
                  Cancel
                </Button>
              }
            />
            <Button
              variant="destructive"
              size="sm"
              onClick={handleRewind}
              disabled={isRewinding}
            >
              {isRewinding && (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              )}
              Rewind
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

/** One icon-only action in the cluster: the shape all of them but Retry share. */
function ClusterButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: LucideIcon
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            onClick={onClick}
            disabled={disabled}
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
