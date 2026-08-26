"use client"

import * as React from "react"
import { Receipt } from "lucide-react"

import type { StoryCostProfile } from "@/lib/types"
import { formatUsdFloor } from "@/lib/format"
import { CostLedger } from "@/components/cost/cost-ledger"
import { COST_TOOLTIP_DELAY_MS } from "@/components/cost/tooltip-delay"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * The story-level cost surface: one icon in the header.
 *
 * Icon, not a figure. This used to render the dollar amount at `md:inline`,
 * which meant a story that had cost nothing sat there showing "$0" forever —
 * a permanent readout of money on the screen someone is trying to write on,
 * and the exact thing this feature promises not to do. It was also absent
 * below `md`, on precisely the viewports where the per-passage figures were
 * always visible, so touch had no way into the ledger at all.
 *
 * Hover summarises; click or Enter opens the ledger. Nothing here ticks during
 * generation: a live counter next to prose being written is the opposite of
 * what this is for.
 */
export function CostChip({
  profile,
  span,
}: {
  profile: StoryCostProfile
  /** First/last generated passage, ISO — passed through to the sparkline. */
  span?: { firstIso: string; lastIso: string } | null
}) {
  const [open, setOpen] = React.useState(false)

  // A total built partly from calls OpenRouter never priced is shown as an
  // explicit floor, never as an exact figure.
  const label = formatUsdFloor(profile.totalUsd, profile.unpricedCalls)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Disabled while the ledger is open so the two portals never stack on
          the same anchor. */}
      <Tooltip disabled={open}>
        <TooltipTrigger
          delay={COST_TOOLTIP_DELAY_MS}
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Spend ledger. This story has cost ${label}.`}
                />
              }
            />
          }
        >
          <Receipt className="size-4" />
        </TooltipTrigger>
        <TooltipContent className="font-mono tabular-nums">
          {label} this story
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[22rem] gap-0 bg-surface-glass-strong p-0 backdrop-blur-md"
        aria-label="Spend ledger"
      >
        <CostLedger profile={profile} span={span} />
      </PopoverContent>
    </Popover>
  )
}
