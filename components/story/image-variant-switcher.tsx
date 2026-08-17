"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { toast } from "sonner"

import { selectImageByOffset } from "@/lib/actions/images"
import type { StoryImage } from "@/lib/types"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * "‹ 2 / 3 ›" under a retried illustration — the passage switcher's twin,
 * deliberately identical in behaviour and appearance.
 *
 * Same reason it is always visible rather than hover-revealed: it is the only
 * evidence that retrying kept the earlier draws, and a writer who never hovers
 * would otherwise believe each retry threw a picture away.
 */
export function ImageVariantSwitcher({
  image,
  storyId,
  disabled,
}: {
  image: StoryImage
  storyId: string
  disabled: boolean
}) {
  const [isSwitching, startSwitching] = React.useTransition()

  const atStart = image.imageIndex <= 0
  const atEnd = image.imageIndex >= image.imageCount - 1

  function switchBy(offset: number) {
    startSwitching(async () => {
      const res = await selectImageByOffset(storyId, image.imageGroupId, offset)
      // Silent on success: the picture changing is the confirmation.
      if (!res.ok) toast.error(res.error)
    })
  }

  const readout = `${image.imageIndex + 1} / ${image.imageCount}`

  return (
    <div className="mt-1 flex items-center justify-end gap-0.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Previous draw"
              disabled={disabled || isSwitching || atStart}
              onClick={() => switchBy(-1)}
            />
          }
        >
          <ChevronLeft />
        </TooltipTrigger>
        <TooltipContent>Previous draw</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <span
              // Not a button — it opens nothing — but keyboard-reachable, since
              // the tooltip it carries is the only place a take's provenance is
              // written down.
              tabIndex={0}
              aria-label={`Draw ${readout}`}
              className="px-1 font-mono text-xs text-muted-foreground tabular-nums outline-none focus-visible:text-foreground"
            />
          }
        >
          {readout}
        </TooltipTrigger>
        <TooltipContent className="flex-col items-start gap-0.5">
          <span className="font-mono">{image.modelId}</span>
          <span className="text-background/70">
            {image.aspectRatio} · seed {image.seed}
            {/* The offline provider drew every SVG here, whatever model the
                row names — the id records what was ASKED for. Saying so is the
                difference between provenance and a claim we can't back. */}
            {image.mediaType === "image/svg+xml" && " · drawn offline"}
          </span>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Next draw"
              disabled={disabled || isSwitching || atEnd}
              onClick={() => switchBy(1)}
            />
          }
        >
          <ChevronRight />
        </TooltipTrigger>
        <TooltipContent>Next draw</TooltipContent>
      </Tooltip>
    </div>
  )
}
