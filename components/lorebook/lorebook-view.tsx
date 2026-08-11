"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, NotebookText } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { LorebookCategory, LorebookEntry } from "@/lib/types"

import { LorebookEntryEditor } from "@/components/lorebook/lorebook-entry-editor"
import { LorebookEntryList } from "@/components/lorebook/lorebook-entry-list"
import { NewEntryDialog } from "@/components/lorebook/new-entry-dialog"

/**
 * The entry that inherits the selection when the selected one disappears:
 * the next one in list order, else the previous one, else the first survivor.
 */
function nextSelection(
  previous: LorebookEntry[],
  current: LorebookEntry[],
  goneId: string
): string | null {
  const alive = new Set(current.map((e) => e.id))
  const index = previous.findIndex((e) => e.id === goneId)
  if (index !== -1) {
    for (let i = index + 1; i < previous.length; i++) {
      if (alive.has(previous[i].id)) return previous[i].id
    }
    for (let i = index - 1; i >= 0; i--) {
      if (alive.has(previous[i].id)) return previous[i].id
    }
  }
  return current[0]?.id ?? null
}

export function LorebookView({
  storyId,
  storyTitle,
  entries,
}: {
  /** Lore is scoped to this story; every entry here belongs to it. */
  storyId: string
  storyTitle: string
  entries: LorebookEntry[]
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    entries[0]?.id ?? null
  )
  const [category, setCategory] = useState<LorebookCategory | "all">("all")
  const [query, setQuery] = useState("")

  // Reconcile the selection with server revalidations: the entries prop is a
  // fresh array after every mutation, so re-resolve by id rather than holding
  // on to a stale object.
  const [seenEntries, setSeenEntries] = useState(entries)
  if (seenEntries !== entries) {
    setSeenEntries(entries)
    if (selectedId === null && seenEntries.length === 0) {
      setSelectedId(entries[0]?.id ?? null)
    } else if (
      selectedId !== null &&
      !entries.some((e) => e.id === selectedId) &&
      // Only inherit when the entry really vanished — a freshly created id can
      // legitimately lead the revalidated list by a render.
      seenEntries.some((e) => e.id === selectedId)
    ) {
      setSelectedId(nextSelection(seenEntries, entries, selectedId))
    }
  }

  const selected = entries.find((e) => e.id === selectedId)

  return (
    <div className="flex h-app flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger />
        <Tooltip>
          {/* The trigger renders the anchor directly. Wrapping it in <Button>
              instead would make Base UI's button expect native <button>
              semantics from an <a>, which it warns about. */}
          <TooltipTrigger
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            aria-label="Back to story"
            render={<Link href={`/story/${storyId}`} />}
          >
            <ArrowLeft className="size-4" />
          </TooltipTrigger>
          <TooltipContent>Back to story</TooltipContent>
        </Tooltip>
        <h1 className="truncate text-sm font-medium">{storyTitle}</h1>
        <span className="shrink-0 text-xs text-muted-foreground">
          Lorebook · {entries.length}{" "}
          {entries.length === 1 ? "entry" : "entries"}
        </span>
        <div className="flex-1" />
        <NewEntryDialog
          storyId={storyId}
          onCreated={(id) => {
            // Clear the filters so the new entry is actually visible in the list.
            setCategory("all")
            setQuery("")
            setSelectedId(id)
          }}
        />
      </header>

      <div className="flex min-h-0 flex-1">
        <LorebookEntryList
          entries={entries}
          category={category}
          onCategoryChange={setCategory}
          query={query}
          onQueryChange={setQuery}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <div className="min-w-0 flex-1">
          {selected ? (
            <ScrollArea className="h-full">
              <div className="mx-auto w-full max-w-xl px-6 py-8">
                <LorebookEntryEditor key={selected.id} entry={selected} />
              </div>
            </ScrollArea>
          ) : (
            <div className="flex h-full items-center justify-center">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <NotebookText />
                  </EmptyMedia>
                  <EmptyTitle>No entry selected</EmptyTitle>
                  <EmptyDescription>
                    Choose an entry from the list, or create a new one.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
