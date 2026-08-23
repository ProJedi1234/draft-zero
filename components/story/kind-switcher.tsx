"use client"

import { MessageSquareQuote, Swords } from "lucide-react"

import type { ActionKind } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * The writer has exactly two moves. They are a segmented pair rather than a
 * dropdown because which one is armed changes what every keystroke means, and
 * that has to be readable without opening anything.
 */
export const KINDS = [
  {
    value: "do",
    label: "Do",
    icon: Swords,
    placeholder: "What do you do?",
  },
  {
    value: "say",
    label: "Say",
    icon: MessageSquareQuote,
    placeholder: "What do you say?",
  },
] as const

export function kindMeta(kind: ActionKind) {
  return KINDS.find((k) => k.value === kind) ?? KINDS[0]
}

/**
 * Shared by the composer, where it arms the next move, and by the passage
 * editor, where it re-kinds an existing one. Both surfaces bind Tab to the
 * swap, so the tooltip on the unarmed move says so in either place.
 */
export function KindSwitcher({
  value,
  onChange,
  disabled,
  size = "sm",
}: {
  value: ActionKind
  onChange: (kind: ActionKind) => void
  disabled?: boolean
  size?: "sm" | "xs"
}) {
  return (
    <div className="flex items-center gap-0.5">
      {KINDS.map((kind) => {
        const selected = kind.value === value
        return (
          <Tooltip key={kind.value}>
            <TooltipTrigger
              render={
                <Button
                  variant={selected ? "secondary" : "ghost"}
                  size={size === "xs" ? "icon-xs" : "icon-sm"}
                  // --secondary and --muted are the same value, so a
                  // secondary fill alone is exactly what ghost:hover
                  // looks like: hovering the unarmed move would make
                  // both buttons identical at the moment of choosing.
                  // The border and the full-contrast icon are the cues
                  // hover cannot imitate.
                  className={cn(
                    selected
                      ? "border-border text-foreground"
                      : "text-muted-foreground"
                  )}
                  aria-label={kind.label}
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => onChange(kind.value)}
                />
              }
            >
              <kind.icon />
            </TooltipTrigger>
            {/* Tab is what takes you to the *other* move, so only the
                unarmed one advertises it. */}
            <TooltipContent>
              {selected ? kind.label : `${kind.label} (Tab)`}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
