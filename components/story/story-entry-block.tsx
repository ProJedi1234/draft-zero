"use client"

import { Pencil, RefreshCw, Trash2 } from "lucide-react"

import type { StoryEntry } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const ACTIONS = [
  { icon: Pencil, label: "Edit passage" },
  { icon: RefreshCw, label: "Retry from here" },
  { icon: Trash2, label: "Delete passage" },
]

export function StoryEntryBlock({ entry }: { entry: StoryEntry }) {
  const paragraphs = entry.text.split("\n\n")

  return (
    <div
      data-source={entry.source}
      className={cn(
        "group relative -mx-4 px-4 py-3 transition-colors hover:bg-muted/40",
        entry.source === "user" && "border-l-2 border-primary/40"
      )}
    >
      {paragraphs.map((para, i) => (
        <p
          key={i}
          className="font-serif text-[1.0625rem] leading-8 text-foreground [&:not(:first-child)]:mt-5"
        >
          {para}
        </p>
      ))}

      <div className="absolute -top-3 right-2 hidden items-center gap-0.5 border bg-background p-0.5 shadow-sm group-hover:flex">
        {ACTIONS.map(({ icon: Icon, label }) => (
          <Tooltip key={label}>
            <TooltipTrigger
              render={<Button variant="ghost" size="icon-xs" aria-label={label} />}
            >
              <Icon />
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}
