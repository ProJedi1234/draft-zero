"use client"

import { Badge } from "@/components/ui/badge"
import type { LorebookEntry } from "@/lib/types"
import { cn } from "@/lib/utils"

import { CategoryIcon } from "@/components/lorebook/category-icon"

export function LorebookEntryRow({
  entry,
  selected,
  onSelect,
}: {
  entry: LorebookEntry
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected || undefined}
      className={cn(
        "w-full border-b px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
        selected && "bg-muted"
      )}
    >
      <div className="flex items-center gap-2">
        <CategoryIcon
          category={entry.category}
          className="shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {entry.name}
        </span>
        {entry.alwaysActive && (
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            Always
          </Badge>
        )}
        {!entry.enabled && (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            Off
          </Badge>
        )}
      </div>
      <p className="mt-0.5 truncate pl-[22px] text-xs text-muted-foreground">
        {entry.keys.join(", ")}
      </p>
    </button>
  )
}
