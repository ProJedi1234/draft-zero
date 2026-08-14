"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { importScenario } from "@/lib/actions/import"
import type { ParsedScenario } from "@/lib/import/novelai"
import { summarize, SummaryRow } from "@/components/import/import-summary"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"

/** A parsed file waiting for confirmation. */
export interface PendingScenario {
  /** Raw file text — the action re-parses this rather than trusting `scenario`. */
  json: string
  scenario: ParsedScenario
}

/**
 * Confirmation step for a NovelAI scenario import: shows what the file
 * contains, collects the scenario's `${…}` placeholders, and lists whatever
 * the reader dropped, before anything is written.
 */
export function ImportScenarioDialog({
  pending,
  onOpenChange,
}: {
  pending: PendingScenario | null
  onOpenChange: (open: boolean) => void
}) {
  // Lifted out of the form so the dialog can refuse to close mid-write.
  // Dismissing does not cancel the action — the rows still land — and the
  // surviving closure then reports success over a dialog that is gone.
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
          <ImportScenarioForm
            pending={pending}
            onBusyChange={setIsBusy}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ImportScenarioForm({
  pending,
  onDone,
  onBusyChange,
}: {
  pending: PendingScenario
  onDone: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const { scenario } = pending
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  React.useEffect(() => {
    onBusyChange(isPending)
  }, [isPending, onBusyChange])
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(scenario.placeholders.map((p) => [p.id, p.defaultValue]))
  )

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isPending) return
    startTransition(async () => {
      try {
        const res = await importScenario({
          json: pending.json,
          placeholderValues: values,
        })
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        const { lorebookEntryCount } = res.data
        toast.success(
          lorebookEntryCount > 0
            ? `Imported "${res.data.title}" and ${lorebookEntryCount} lorebook ${
                lorebookEntryCount === 1 ? "entry" : "entries"
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

  const loreCount = scenario.lorebookEntries.length

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-col gap-4">
      <DialogHeader>
        <DialogTitle className="truncate">{scenario.title}</DialogTitle>
        <DialogDescription>
          {scenario.author ? `NovelAI scenario by ${scenario.author}` : null}
          {scenario.author ? " · " : null}
          {scenario.description || "NovelAI scenario"}
        </DialogDescription>
      </DialogHeader>

      <ScrollArea className="max-h-[55svh] pr-3">
        <div className="flex flex-col gap-5">
          {scenario.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {scenario.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {scenario.placeholders.length > 0 && (
            <div className="flex flex-col gap-3">
              {scenario.placeholders.map((placeholder) => (
                <div key={placeholder.id} className="flex flex-col gap-2">
                  <Label htmlFor={`placeholder-${placeholder.id}`}>
                    {placeholder.title || placeholder.id}
                  </Label>
                  {placeholder.description && (
                    <p className="text-xs text-muted-foreground">
                      {placeholder.description}
                    </p>
                  )}
                  <Input
                    id={`placeholder-${placeholder.id}`}
                    value={values[placeholder.id] ?? ""}
                    placeholder={placeholder.defaultValue}
                    disabled={isPending}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [placeholder.id]: event.target.value,
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <SummaryRow label="Prompt" value={summarize(scenario.prompt)} />
            <SummaryRow label="Memory" value={summarize(scenario.memory)} />
            <SummaryRow
              label="Author's note"
              value={summarize(scenario.authorsNote)}
            />
            <SummaryRow
              label="Lorebook"
              value={
                loreCount === 0
                  ? "None"
                  : `${loreCount} ${loreCount === 1 ? "entry" : "entries"}`
              }
            />
          </dl>

          {scenario.warnings.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {scenario.warnings.map((warning) => (
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
