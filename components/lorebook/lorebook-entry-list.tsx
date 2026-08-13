"use client"

import * as React from "react"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { LOREBOOK_CATEGORIES, type LorebookCategory } from "@/lib/types"
import type { LorebookEntry } from "@/lib/types"

import { LorebookEntryRow } from "@/components/lorebook/lorebook-entry-row"

export interface LorebookEntryListProps {
  /** Every entry — the list filters internally so chip counts stay full-set. */
  entries: LorebookEntry[]
  category: LorebookCategory | "all"
  onCategoryChange: (c: LorebookCategory | "all") => void
  query: string
  onQueryChange: (q: string) => void
  selectedId: string | null
  onSelect: (id: string) => void
  /** The view owns whether this pane is the visible one on mobile. */
  className?: string
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

/**
 * Holds the rendered order steady while the set of entries is unchanged.
 *
 * The server orders by name ASC and the editor autosaves the Name field every
 * 600 ms, so without this the row being renamed walks through the list under the
 * writer's cursor — twice a second, mid-word. The order is only recomputed when
 * an entry actually appears or disappears; new ids join at the end and survive
 * there until the next load re-sorts alphabetically.
 */
function useStableOrder(entries: LorebookEntry[]): LorebookEntry[] {
  // Identity of the *set*, independent of the server's name ordering.
  const idKey = entries
    .map((entry) => entry.id)
    .sort()
    .join("|")

  const orderedIds = React.useMemo(
    () => entries.map((entry) => entry.id),
    // Deliberately keyed on the id set, not on `entries`: a rename produces a
    // new array in a new order, and re-running here is exactly the jank this
    // hook exists to prevent. Order is refreshed from the server whenever an
    // entry is actually added or removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idKey]
  )

  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  return orderedIds
    .map((id) => byId.get(id))
    .filter((entry): entry is LorebookEntry => entry !== undefined)
}

function matchesQuery(entry: LorebookEntry, needle: string): boolean {
  if (needle === "") return true
  return (
    entry.name.toLowerCase().includes(needle) ||
    entry.keys.some((k) => k.toLowerCase().includes(needle))
  )
}

export function LorebookEntryList(props: LorebookEntryListProps) {
  const {
    entries,
    category,
    onCategoryChange,
    query,
    onQueryChange,
    selectedId,
    onSelect,
    className,
  } = props

  const needle = query.trim().toLowerCase()
  const ordered = useStableOrder(entries)
  const visible = ordered.filter(
    (entry) =>
      // The open entry always stays in the list: renaming it re-runs the filter
      // against a half-typed name, which would otherwise make the row the writer
      // is editing vanish out from under them.
      entry.id === selectedId ||
      ((category === "all" || entry.category === category) &&
        matchesQuery(entry, needle))
  )

  return (
    // Full-bleed below md, where it is the whole screen; a fixed rail beside
    // the editor from md up.
    <div
      className={cn(
        "flex w-full shrink-0 flex-col border-r md:w-80",
        className
      )}
    >
      <div className="space-y-2 p-3">
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search by name or key..."
          aria-label="Search lorebook"
        />
        <div className="flex flex-wrap gap-1">
          {CATEGORY_CHIPS.map((chip) => {
            const active = chip.value === category
            const count =
              chip.value === "all"
                ? entries.length
                : entries.filter((e) => e.category === chip.value).length
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
      {/* Bottom pad clears the home indicator; see app/page.tsx. */}
      <ScrollArea className="min-h-0 flex-1 pb-[env(safe-area-inset-bottom)]">
        {visible.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-muted-foreground">
            {needle === "" ? "Nothing in this category yet." : "No matches."}
          </div>
        ) : (
          visible.map((entry) => (
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
