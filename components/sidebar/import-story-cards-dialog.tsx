"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { importStoryCards } from "@/lib/actions/import"
import type { ParsedStoryCards } from "@/lib/import/aidungeon"
import {
  categoryBreakdown,
  summarize,
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

/** A parsed export waiting for confirmation. */
export interface PendingStoryCards {
  /** Raw file text — the action re-parses this rather than trusting `cards`. */
  json: string
  cards: ParsedStoryCards
}

/**
 * Confirmation step for an AI Dungeon story-card import: shows what the file
 * carries and what the reader had to coerce, before anything is written.
 *
 * A card export is a world rather than a story, so the preview leads with the
 * lorebook — that is the whole payload — and the prose fields come second.
 */
export function ImportStoryCardsDialog({
  pending,
  onOpenChange,
}: {
  pending: PendingStoryCards | null
  onOpenChange: (open: boolean) => void
}) {
  // Lifted out of the form so the dialog itself can refuse to close mid-write.
  // Dismissing while the action is in flight does not cancel it — the rows
  // still land — and the surviving closure then toasts success and navigates
  // into the story the writer just cancelled creating.
  const [isBusy, setIsBusy] = React.useState(false)

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open && isBusy) return
        onOpenChange(open)
      }}
      disablePointerDismissal={isBusy}
    >
      <DialogContent className="sm:max-w-lg">
        {pending && (
          <ImportStoryCardsForm
            pending={pending}
            onBusyChange={setIsBusy}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ImportStoryCardsForm({
  pending,
  onDone,
  onBusyChange,
}: {
  pending: PendingStoryCards
  onDone: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const { cards } = pending
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  React.useEffect(() => {
    onBusyChange(isPending)
  }, [isPending, onBusyChange])

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isPending) return
    startTransition(async () => {
      try {
        const res = await importStoryCards({ json: pending.json })
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        const { lorebookEntryCount } = res.data
        toast.success(
          `Imported "${res.data.title}" and ${lorebookEntryCount} lorebook ${
            lorebookEntryCount === 1 ? "entry" : "entries"
          }`
        )
        onDone()
        router.push(`/story/${res.data.storyId}`)
      } catch {
        // A server action can REJECT rather than return {ok:false} — a body-size
        // rejection, a dropped connection, a constraint error. Unguarded, the
        // rejection escapes the transition callback: no toast, no close, and
        // React escalates to the nearest error boundary.
        toast.error("That import couldn't be completed. Nothing was saved.")
      }
    })
  }

  // Mirrors what `importStoryCards` writes: the setting bible becomes the
  // story's memory, so its always-active copy is dropped rather than injected
  // into every prompt a second time.
  const lore = cards.lorebookEntries
  const loreCount = lore.length
  const categories = categoryBreakdown(lore)

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-col gap-4">
      <DialogHeader>
        <DialogTitle className="truncate">{cards.title}</DialogTitle>
        <DialogDescription>
          {cards.description || "AI Dungeon story cards"}
        </DialogDescription>
      </DialogHeader>

      <ScrollArea className="max-h-[55svh] pr-3">
        <div className="flex flex-col gap-5">
          {cards.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {cards.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <SummaryRow
              label="Lorebook"
              value={`${loreCount} ${loreCount === 1 ? "entry" : "entries"}`}
            />
            {/* "None" rather than an empty cell: a worldDescription-only export
                has no ordinary lore, and a blank value reads as a rendering
                bug. The scenario dialog has always guarded this; the shared
                extraction dropped it. */}
            <SummaryRow
              label="Categories"
              value={categories.length > 0 ? categories.join(" · ") : "None"}
            />
            {/* The setting bible becomes the new story's memory rather than a
                lorebook entry, so it earns its own row. */}
            <SummaryRow
              label="World"
              value={summarize(cards.worldDescription)}
            />
            <SummaryRow label="Prompt" value={summarize(cards.prompt)} />
            <SummaryRow label="Memory" value={summarize(cards.memory)} />
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
        <DialogClose
          disabled={isPending}
          render={<Button type="button" variant="outline" />}
        >
          Cancel
        </DialogClose>
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : null}
          Import
        </Button>
      </DialogFooter>
    </form>
  )
}
