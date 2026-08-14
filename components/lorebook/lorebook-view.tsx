"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, NotebookText } from "lucide-react"

import { Button, buttonVariants } from "@/components/ui/button"
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
import { cn } from "@/lib/utils"
import type { LorebookCategory, LorebookEntry } from "@/lib/types"

import { ImportCardsDialog } from "@/components/lorebook/import-cards-dialog"
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
  // Below md the list and the editor are one screen each, not two columns —
  // 320px of rail plus an editor leaves ~70px for the editor on a phone. This
  // is which of the two is showing; from md up both are, and it is inert.
  const [showEntry, setShowEntry] = useState(false)

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
      const inheritor = nextSelection(seenEntries, entries, selectedId)
      setSelectedId(inheritor)
      // Nothing left to inherit — don't strand a phone on an empty pane.
      if (inheritor === null) setShowEntry(false)
    }
  }

  const selected = entries.find((e) => e.id === selectedId)

  return (
    <div className="flex h-app flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger />
        {/* While an entry fills a phone screen, Back means "back to the list" —
            the only way out of the editor. At md+ both panes are visible, so
            Back keeps its single meaning of "back to the story". */}
        {showEntry && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to entries"
            onClick={() => setShowEntry(false)}
            className="md:hidden"
          >
            <ArrowLeft className="size-4" />
          </Button>
        )}
        <Tooltip>
          {/* The trigger renders the anchor directly. Wrapping it in <Button>
              instead would make Base UI's button expect native <button>
              semantics from an <a>, which it warns about. */}
          <TooltipTrigger
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-sm" }),
              showEntry && "hidden md:inline-flex"
            )}
            aria-label="Back to story"
            render={<Link href={`/story/${storyId}`} />}
          >
            <ArrowLeft className="size-4" />
          </TooltipTrigger>
          <TooltipContent>Back to story</TooltipContent>
        </Tooltip>
        <h1 className="truncate text-sm font-medium">{storyTitle}</h1>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
          Lorebook · {entries.length}{" "}
          {entries.length === 1 ? "entry" : "entries"}
        </span>
        <div className="flex-1" />
        <ImportCardsDialog
          storyId={storyId}
          entryNames={entries.map((e) => e.name)}
          onImported={() => {
            // Clear the filters so the merged entries are actually visible.
            // Deliberately no selection change: a merge lands many entries at
            // once, and jumping into one arbitrary card's editor would strand a
            // phone there. But below md the editor IS the screen, so a writer
            // sitting in one would see nothing change except a toast — send
            // them back to the list, which is where the new entries are.
            setCategory("all")
            setQuery("")
            setShowEntry(false)
          }}
        />
        <NewEntryDialog
          storyId={storyId}
          onCreated={(id) => {
            // Clear the filters so the new entry is actually visible in the list.
            setCategory("all")
            setQuery("")
            setSelectedId(id)
            // A new entry is empty by definition — go straight to editing it.
            setShowEntry(true)
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
          onSelect={(id) => {
            setSelectedId(id)
            setShowEntry(true)
          }}
          className={cn(showEntry && "hidden md:flex")}
        />
        <div className={cn("min-w-0 flex-1", !showEntry && "hidden md:block")}>
          {selected ? (
            <ScrollArea className="h-full">
              {/* Bottom pad clears the home indicator; see app/page.tsx. */}
              <div className="mx-auto w-full max-w-xl px-6 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
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
