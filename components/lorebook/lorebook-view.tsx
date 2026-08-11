"use client"

import { useState } from "react"
import { NotebookText } from "lucide-react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  MOCK_LOREBOOK_ENTRIES,
  getLorebookEntriesByCategory,
  getLorebookEntryById,
} from "@/lib/mock-data"
import type { LorebookCategory } from "@/lib/types"

import { LorebookEntryEditor } from "@/components/lorebook/lorebook-entry-editor"
import { LorebookEntryList } from "@/components/lorebook/lorebook-entry-list"
import { NewEntryDialog } from "@/components/lorebook/new-entry-dialog"

export function LorebookView() {
  const [selectedId, setSelectedId] = useState<string | null>(
    MOCK_LOREBOOK_ENTRIES[0]?.id ?? null
  )
  const [category, setCategory] = useState<LorebookCategory | "all">("all")

  const entries = getLorebookEntriesByCategory(category)
  const selected = selectedId ? getLorebookEntryById(selectedId) : undefined

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-4" />
        <h1 className="text-sm font-medium">Lorebook</h1>
        <span className="text-xs text-muted-foreground">
          {MOCK_LOREBOOK_ENTRIES.length} entries
        </span>
        <div className="flex-1" />
        <NewEntryDialog />
      </header>

      <div className="flex min-h-0 flex-1">
        <LorebookEntryList
          entries={entries}
          category={category}
          onCategoryChange={setCategory}
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
