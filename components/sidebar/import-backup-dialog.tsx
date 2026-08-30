"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { importAiDungeonBackup } from "@/lib/actions/import"
import type { ParsedBackup } from "@/lib/import/aidungeon-backup"
import {
  categoryBreakdown,
  summarize,
  SummaryRow,
} from "@/components/import/import-summary"
import { Badge } from "@/components/ui/badge"
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

/** A read archive waiting for confirmation. */
export interface PendingBackup {
  /**
   * The archive itself. The action re-reads these bytes rather than trusting
   * `backup` — and it is the File, not its text, because a backup is binary
   * and its compression is what keeps a long adventure inside a request body.
   */
  file: File
  backup: ParsedBackup
}

/**
 * Confirmation step for an AI Dungeon backup import: shows what the archive
 * carries and what the reader had to drop, before anything is written.
 *
 * A backup is the one AI Dungeon format that arrives as a manuscript, so the
 * preview leads with the passage count — that is what makes this different from
 * importing the same adventure's story cards, and the number a writer needs to
 * see before they agree to create a story with a thousand rows in it.
 */
export function ImportBackupDialog({
  pending,
  onOpenChange,
}: {
  pending: PendingBackup | null
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
      <DialogContent sheet className="sm:max-w-lg">
        {pending && (
          <ImportBackupForm
            pending={pending}
            onBusyChange={setIsBusy}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ImportBackupForm({
  pending,
  onDone,
  onBusyChange,
}: {
  pending: PendingBackup
  onDone: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const { backup } = pending
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
        const res = await importAiDungeonBackup({ file: pending.file })
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        const { passageCount } = res.data
        toast.success(
          passageCount > 0
            ? `Imported "${res.data.title}" and ${passageCount} ${
                passageCount === 1 ? "passage" : "passages"
              }`
            : `Imported "${res.data.title}"`
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

  // Mirrors what `importAiDungeonBackup` writes: the setting bible becomes the
  // story's memory, so its always-active copy is dropped rather than injected
  // into every prompt a second time.
  const lore = backup.lorebookEntries
  const loreCount = lore.length
  const categories = categoryBreakdown(lore)
  const passageCount = backup.passages.length
  const turnCount = backup.passages.filter(
    (passage) => passage.actionKind !== null
  ).length

  return (
    <form
      onSubmit={handleSubmit}
      className="flex min-h-0 flex-col gap-4 max-sm:flex-1"
    >
      <DialogHeader>
        <DialogTitle className="truncate">{backup.title}</DialogTitle>
        {/* Clamped, unlike the other two previews. An AI Dungeon adventure's
            description is not a blurb — it is very often the whole opening
            passage copied in, and the sample's runs to 884 characters, which
            pushed every row of the summary below the fold on a phone. The
            description is context for the title, not the thing being previewed. */}
        <DialogDescription className="line-clamp-3">
          {backup.description || "AI Dungeon adventure backup"}
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="sm:max-h-[55svh]">
        <div className="flex flex-col gap-5">
          {backup.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {backup.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            {/* The manuscript first: it is the whole reason this format exists
                beside the card export, and the one number that tells a writer
                whether they are about to import a world or a novel. */}
            <SummaryRow
              label="Story"
              value={
                passageCount === 0
                  ? "Empty"
                  : `${passageCount} ${
                      passageCount === 1 ? "passage" : "passages"
                    }${turnCount > 0 ? ` · ${turnCount} of them yours` : ""}`
              }
            />
            <SummaryRow
              label="Lorebook"
              value={
                loreCount === 0
                  ? "None"
                  : `${loreCount} ${loreCount === 1 ? "entry" : "entries"}`
              }
            />
            <SummaryRow
              label="Categories"
              value={categories.length > 0 ? categories.join(" · ") : "None"}
            />
            {/* The setting bible becomes the new story's memory rather than a
                lorebook entry, so it earns its own row. */}
            <SummaryRow
              label="World"
              value={summarize(backup.worldDescription)}
            />
            <SummaryRow label="Memory" value={summarize(backup.memory)} />
            <SummaryRow
              label="Author's note"
              value={summarize(backup.authorsNote)}
            />
            <SummaryRow label="Summary" value={summarize(backup.summary)} />
            {/* Its own row rather than a line in the warnings alone: this is
                the one field that changes how the model is instructed rather
                than what it is told, and "Built-in" is the answer for most
                adventures — a writer should be able to see which they have. */}
            <SummaryRow
              label="Narrator"
              value={
                backup.instructions === ""
                  ? "Built-in"
                  : `Replaced · ${summarize(backup.instructions)}`
              }
            />
          </dl>

          {backup.warnings.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {backup.warnings.map((warning) => (
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
      </DialogBody>

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
