"use client"

import * as React from "react"
import { CircleDollarSign } from "lucide-react"

import { formatUsd, shortModelId } from "@/lib/format"
import type { StoryImage } from "@/lib/types"
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
 * The money lines, shared by the hover tooltip and the tapped popover so the
 * two can never drift into telling different stories about one picture.
 */
function ImageCostDetail({ image }: { image: StoryImage }) {
  // Aborted and errored draws are the ones OpenRouter never prices — and under
  // all-or-nothing image billing they genuinely cost nothing, which is a
  // stronger statement than the text side can make about a stopped call.
  const stopped = image.callStatus === "aborted" || image.callStatus === "error"

  // "+" whenever a settled draw in this slot went unpriced: the total is then a
  // floor, and printing it bare would present an undercount as exact.
  const slotSuffix = image.slotUnpricedCalls > 0 ? "+" : ""

  return (
    <>
      <span>
        {image.costUsd !== null
          ? `${formatUsd(image.costUsd)} this draw`
          : stopped
            ? "not billed — stopped before it finished"
            : "cost not recorded"}
      </span>
      {/* Only once there is more than one draw: on a slot of one the total and
          the draw are the same number, and printing it twice reads as two
          different charges. */}
      {image.imageCount > 1 && image.slotCostUsd !== null && (
        <span className="opacity-70">
          {formatUsd(image.slotCostUsd)}
          {slotSuffix} across {image.imageCount} draws
        </span>
      )}
      {/* The one place a single-draw picture's model is written down — the
          take switcher carries provenance, but it only renders past one draw. */}
      <span className="opacity-70">{shortModelId(image.modelId)}</span>
    </>
  )
}

/**
 * What a picture cost, in its hover cluster — the same question EntryCostChip
 * answers for a passage, and deliberately the same shape, because a writer
 * scanning a manuscript should not have to learn two cost affordances. That
 * sameness is load-bearing: an earlier version was a bare glyph with a
 * hover-only tooltip, which put the figure out of reach of touch entirely —
 * on a phone or iPad, tapping it did nothing, and the cost simply never
 * appeared. So, exactly like the passage chip: the figure printed inline
 * where the cluster is hover-hidden at rest (md and up), a bare glyph where
 * it is permanently visible (touch), hover answered with a tooltip and tap or
 * Enter with the same lines in a popover.
 */
export function ImageCostChip({ image }: { image: StoryImage }) {
  const [open, setOpen] = React.useState(false)

  const figure = formatUsd(image.costUsd)
  const label =
    image.costUsd === null
      ? "Cost not recorded for this illustration. Show details."
      : `This draw cost ${figure}. Show details.`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip disabled={open}>
        <TooltipTrigger
          delay={COST_TOOLTIP_DELAY_MS}
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={label}
                  // The button's own register is uppercase, semibold and
                  // letter-spaced, which is right for a word and wrong for a
                  // price. Widens past the icon box only where the figure shows.
                  className="font-mono text-[0.6875rem] font-normal tracking-normal tabular-nums md:w-auto md:px-1.5"
                />
              }
            />
          }
        >
          <CircleDollarSign className="md:hidden" />
          <span className="hidden md:inline">{figure}</span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="end"
          className="flex-col items-start gap-0.5 text-left font-mono text-[0.6875rem] leading-5 tabular-nums"
        >
          <ImageCostDetail image={image} />
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="end"
        className="w-auto max-w-[16rem] gap-0.5 p-3 font-mono text-[0.6875rem] leading-5 tabular-nums"
        aria-label="Illustration cost"
      >
        <ImageCostDetail image={image} />
      </PopoverContent>
    </Popover>
  )
}
