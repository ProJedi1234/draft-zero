"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { importScenario } from "@/lib/actions/import"
import type { ParsedScenario } from "@/lib/import/novelai"
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
  return (
    <Dialog open={pending !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {pending && (
          <ImportScenarioForm
            pending={pending}
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
}: {
  pending: PendingScenario
  onDone: () => void
}) {
  const { scenario } = pending
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(scenario.placeholders.map((p) => [p.id, p.defaultValue]))
  )

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isPending) return
    startTransition(async () => {
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
        <DialogClose render={<Button type="button" variant="outline" />}>
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

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </>
  )
}

/** Word count for a field, or "Empty" — enough to see what a file carries. */
function summarize(text: string): string {
  const trimmed = text.trim()
  if (trimmed === "") return "Empty"
  const words = trimmed.split(/\s+/).length
  return `${words} ${words === 1 ? "word" : "words"}`
}
