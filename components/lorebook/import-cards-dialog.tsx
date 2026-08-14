"use client"

import * as React from "react"
import { Loader2, TriangleAlert, Upload } from "lucide-react"
import { toast } from "sonner"

import { importStoryCardsIntoStory } from "@/lib/actions/import"
import {
  MAX_CARDS_BYTES,
  parseStoryCards,
  STORY_CARD_FILE_ACCEPT,
  type ParsedStoryCards,
} from "@/lib/import/aidungeon"
import type { NewLorebookEntry } from "@/lib/types"
import {
  categoryBreakdown,
  SummaryRow,
} from "@/components/import/import-summary"
import { Badge } from "@/components/ui/badge"
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
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const LABEL = "Import story cards"

/** A parsed export waiting for confirmation. */
interface PendingCards {
  /** Raw file text — the action re-parses this rather than trusting `cards`. */
  json: string
  cards: ParsedStoryCards
}

/**
 * Merges an AI Dungeon story-card export into the open story's lorebook.
 *
 * This is the second of the two import paths: the sidebar one makes a new story
 * out of a card file, this one folds a card pack into a story that already
 * exists. The story's memory is left alone here — only the lorebook grows —
 * which is why the setting bible arrives as an always-active entry instead.
 *
 * The parse happens here purely to preview the file; `importStoryCardsIntoStory`
 * re-parses the same text server-side.
 */
export function ImportCardsDialog({
  storyId,
  entryNames,
  onImported,
}: {
  /** The story whose lorebook the cards are merged into. */
  storyId: string
  /** Names already in that lorebook — what the collision preview counts against. */
  entryNames: string[]
  /** Fired after a successful merge so the view can clear its filters. */
  onImported?: () => void
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [pending, setPending] = React.useState<PendingCards | null>(null)

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Reset first: picking the same file twice must fire `change` both times.
    event.target.value = ""
    if (!file) return

    if (file.size > MAX_CARDS_BYTES) {
      toast.error("That file is too large to be an export.")
      return
    }

    const json = await file.text()
    const parsed = parseStoryCards(json)
    if (!parsed.ok) {
      toast.error(parsed.error)
      return
    }
    setPending({ json, cards: parsed.data })
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={STORY_CARD_FILE_ACCEPT}
        className="hidden"
        onChange={handleFile}
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={LABEL}
              onClick={() => inputRef.current?.click()}
            />
          }
        >
          <Upload className="size-4" />
        </TooltipTrigger>
        <TooltipContent>{LABEL}</TooltipContent>
      </Tooltip>
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {/* Mounted only while a file is pending, so the form starts clean for
              every pick. */}
          {pending && (
            <ImportCardsForm
              storyId={storyId}
              pending={pending}
              entryNames={entryNames}
              onDone={() => setPending(null)}
              onImported={onImported}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function ImportCardsForm({
  storyId,
  pending,
  entryNames,
  onDone,
  onImported,
}: {
  storyId: string
  pending: PendingCards
  entryNames: string[]
  onDone: () => void
  onImported?: () => void
}) {
  const { cards } = pending
  const [isPending, startTransition] = React.useTransition()

  const split = splitByCollision(cards.lorebookEntries, entryNames)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isPending) return
    startTransition(async () => {
      const res = await importStoryCardsIntoStory({
        storyId,
        json: pending.json,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      const { lorebookEntryCount, skippedCount } = res.data
      toast.success(
        lorebookEntryCount === 0
          ? "Every card was already in this lorebook"
          : `Added ${lorebookEntryCount} lorebook ${
              lorebookEntryCount === 1 ? "entry" : "entries"
            }${skippedCount > 0 ? `, skipped ${skippedCount} already here` : ""}`
      )
      onDone()
      onImported?.()
    })
  }

  const cardCount = cards.lorebookEntries.length

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Import story cards</DialogTitle>
        <DialogDescription className="truncate">
          {cards.title} · {cardCount} {cardCount === 1 ? "card" : "cards"}
        </DialogDescription>
      </DialogHeader>

      <ScrollArea className="max-h-[55svh] pr-3">
        <div className="flex flex-col gap-5">
          {split.categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {split.categories.map((category) => (
                <Badge key={category} variant="secondary">
                  {category}
                </Badge>
              ))}
            </div>
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <SummaryRow
              label="New entries"
              value={`${split.newCount} of ${cardCount}`}
            />
            {/* The action skips a card whose name is already here rather than
                overwriting a hand-edited entry — say so before the writer
                commits, not after. */}
            <SummaryRow
              label="Already here"
              value={
                split.collidingCount === 0
                  ? "None"
                  : `${split.collidingCount} kept as ${
                      split.collidingCount === 1 ? "it is" : "they are"
                    }`
              }
            />
          </dl>

          {cards.warnings.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {cards.warnings.map((warning) => (
                <li
                  key={warning}
                  className="flex gap-2 text-xs text-muted-foreground"
                >
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                  {warning}
                </li>
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        {/* Nothing to write when every card collides — the merge would be a
            no-op, so the button says why instead of pretending to work. */}
        <Button type="submit" disabled={isPending || split.newCount === 0}>
          {isPending ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : null}
          {split.newCount === 0
            ? "Nothing to add"
            : `Add ${split.newCount} ${
                split.newCount === 1 ? "entry" : "entries"
              }`}
        </Button>
      </DialogFooter>
    </form>
  )
}

interface CollisionSplit {
  newCount: number
  collidingCount: number
  /** "8 Locations · 3 Characters" for the cards that will actually be written. */
  categories: string[]
}

/**
 * Mirrors the merge action's collision rule so the preview and the write agree:
 * a card is skipped when the story already has an entry with that name, matched
 * on the trimmed name case-insensitively, and each accepted card claims its own
 * name in turn — two same-titled cards inside one file are not a collision the
 * story had, so the second one is a new entry, not a skip.
 */
function splitByCollision(
  entries: NewLorebookEntry[],
  entryNames: string[]
): CollisionSplit {
  const taken = new Set(entryNames.map((name) => name.trim().toLowerCase()))
  const accepted: NewLorebookEntry[] = []
  let collidingCount = 0

  for (const entry of entries) {
    const fold = entry.name.trim().toLowerCase()
    if (taken.has(fold)) {
      collidingCount += 1
      continue
    }
    taken.add(fold)
    accepted.push(entry)
  }

  return {
    newCount: accepted.length,
    collidingCount,
    categories: categoryBreakdown(accepted),
  }
}
