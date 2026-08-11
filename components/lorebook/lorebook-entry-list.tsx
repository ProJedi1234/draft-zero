"use client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  MOCK_LOREBOOK_ENTRIES,
  getLorebookEntriesByCategory,
} from "@/lib/mock-data"
import { LOREBOOK_CATEGORIES, type LorebookCategory } from "@/lib/types"
import type { LorebookEntry } from "@/lib/types"

import { LorebookEntryRow } from "@/components/lorebook/lorebook-entry-row"

export interface LorebookEntryListProps {
  entries: LorebookEntry[]
  category: LorebookCategory | "all"
  onCategoryChange: (c: LorebookCategory | "all") => void
  selectedId: string | null
  onSelect: (id: string) => void
}

const CATEGORY_CHIPS: ReadonlyArray<{
  value: LorebookCategory | "all"
  label: string
}> = [
  { value: "all", label: "All" },
  ...LOREBOOK_CATEGORIES.map((c) => ({
    value: c.value,
    label: c.pluralLabel,
  })),
]

export function LorebookEntryList(props: LorebookEntryListProps) {
  const { entries, category, onCategoryChange, selectedId, onSelect } = props

  return (
    <div className="flex w-80 shrink-0 flex-col border-r">
      <div className="space-y-2 p-3">
        <Input
          placeholder="Search by name or key..."
          aria-label="Search lorebook"
        />
        <div className="flex flex-wrap gap-1">
          {CATEGORY_CHIPS.map((chip) => {
            const active = chip.value === category
            const count =
              chip.value === "all"
                ? MOCK_LOREBOOK_ENTRIES.length
                : getLorebookEntriesByCategory(chip.value).length
            return (
              <Button
                key={chip.value}
                size="xs"
                variant={active ? "secondary" : "ghost"}
                onClick={() => onCategoryChange(chip.value)}
              >
                {chip.label}
                <span className="ml-1 text-muted-foreground">{count}</span>
              </Button>
            )
          })}
        </div>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {entries.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-muted-foreground">
            Nothing in this category yet.
          </div>
        ) : (
          entries.map((entry) => (
            <LorebookEntryRow
              key={entry.id}
              entry={entry}
              selected={entry.id === selectedId}
              onSelect={() => onSelect(entry.id)}
            />
          ))
        )}
      </ScrollArea>
    </div>
  )
}
