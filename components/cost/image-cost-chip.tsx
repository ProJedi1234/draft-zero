"use client"

import * as React from "react"
import { CircleDollarSign } from "lucide-react"

import { formatUsd } from "@/lib/format"
import type { StoryImage } from "@/lib/types"
import { COST_TOOLTIP_DELAY_MS } from "@/components/cost/tooltip-delay"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * What a picture cost, in its hover cluster — the same question EntryCostChip
 * answers for a passage, and deliberately the same glyph and delay, because a
 * writer scanning a manuscript should not have to learn two cost affordances.
 *
 * It differs in the one way images differ: a retried illustration has been paid
 * for more than once, so the tooltip leads with the SLOT total when there is
 * more than one draw. Showing only the visible take would under-report a slot
 * three draws deep by exactly the amount that surprises people.
 */
export function ImageCostChip({ image }: { image: StoryImage }) {
  // Aborted and errored draws are the ones OpenRouter never prices — and under
  // all-or-nothing image billing they genuinely cost nothing, which is a
  // stronger statement than the text side can make about a stopped call.
  const stopped = image.callStatus === "aborted" || image.callStatus === "error"

  const multiple = image.imageCount > 1
  // "+" whenever a settled draw in this slot went unpriced: the total is then a
  // floor, and printing it bare would present an undercount as exact.
  const slotSuffix = image.slotUnpricedCalls > 0 ? "+" : ""

  return (
    <Tooltip>
      {/* The delay lives on the trigger, matching EntryCostChip: money is a
          glance the writer asks for, not one the cluster volunteers. */}
      <TooltipTrigger
        delay={COST_TOOLTIP_DELAY_MS}
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={
              image.costUsd === null
                ? "Cost not recorded"
                : `This draw cost ${formatUsd(image.costUsd)}`
            }
            className="text-muted-foreground"
          />
        }
      >
        <CircleDollarSign />
      </TooltipTrigger>
      <TooltipContent className="flex-col items-start gap-0.5">
        <span>
          {image.costUsd !== null
            ? formatUsd(image.costUsd)
            : stopped
              ? "not billed — stopped before it finished"
              : "cost not recorded"}
          {image.costUsd !== null && " this draw"}
        </span>
        {/* Only once there is more than one draw: on a slot of one the total
            and the draw are the same number, and printing it twice reads as
            two different charges. */}
        {multiple && image.slotCostUsd !== null && (
          <span className="text-background/70">
            {formatUsd(image.slotCostUsd)}
            {slotSuffix} across {image.imageCount} draws
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
