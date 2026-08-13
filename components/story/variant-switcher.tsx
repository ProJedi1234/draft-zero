"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { toast } from "sonner"

import { selectVariantByOffset } from "@/lib/actions/history"
import { THINKING_LEVEL_LABELS, type StoryEntry } from "@/lib/types"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * The take browser: "‹ 2 / 3 ›" under a passage that has been retried.
 *
 * Always visible, unlike the hover-revealed action cluster: it is the only
 * evidence that the other takes were kept, and a writer who never hovers would
 * otherwise never learn that retrying stopped throwing prose away. Rendered
 * only when there is something to browse, so an untouched manuscript is
 * unchanged.
 */
export function VariantSwitcher({
  entry,
  storyId,
  disabled,
}: {
  entry: StoryEntry
  storyId: string
  /** True while a generation or another mutation owns the manuscript. */
  disabled: boolean
}) {
  const [isSwitching, startSwitching] = React.useTransition()

  const atStart = entry.variantIndex <= 0
  const atEnd = entry.variantIndex >= entry.variantCount - 1

  // The offset, not the sibling's id: the canvas only ever holds the active
  // take, so the server resolves the neighbour (see selectVariantByOffset).
  function switchBy(offset: number) {
    startSwitching(async () => {
      const res = await selectVariantByOffset(storyId, entry.id, offset)
      // Silent on success: the prose changing is the confirmation, and a toast
      // per arrow press would be noise while comparing takes.
      if (!res.ok) toast.error(res.error)
    })
  }

  const readout = `${entry.variantIndex + 1} / ${entry.variantCount}`

  /**
   * Why two takes of the same passage read differently is a question about the
   * settings they were generated under, and those are frozen per take — the
   * story's current settings cannot answer it. Absent on user passages and on
   * takes written before provenance was recorded, where the readout carries no
   * tooltip at all rather than an invented one.
   */
  const provenance = entry.generation

  return (
    <div className="mt-1 flex items-center justify-end gap-0.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Previous take"
              disabled={disabled || isSwitching || atStart}
              onClick={() => switchBy(-1)}
            />
          }
        >
          <ChevronLeft />
        </TooltipTrigger>
        <TooltipContent>Previous take</TooltipContent>
      </Tooltip>

      {provenance ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                // Not a button: it opens nothing and does nothing on click, but
                // it must still be reachable by keyboard, because the tooltip it
                // carries is the only place the provenance is written down.
                tabIndex={0}
                aria-label={`Take ${readout}`}
                className="px-1 font-mono text-xs text-muted-foreground tabular-nums outline-none focus-visible:text-foreground"
              />
            }
          >
            {readout}
          </TooltipTrigger>
          <TooltipContent className="flex-col items-start gap-0.5">
            <span className="font-mono">{provenance.modelId}</span>
            <span className="text-background/70">
              Thinking{" "}
              {THINKING_LEVEL_LABELS[provenance.thinking].toLowerCase()}
              {" · temp "}
              {provenance.temperature}
              {/* Null means the provider sent no usage event, which is not
                  zero tokens — so the clause is dropped rather than printed. */}
              {provenance.completionTokens !== null &&
                ` · ${provenance.completionTokens} tokens`}
            </span>
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="px-1 font-mono text-xs text-muted-foreground tabular-nums">
          {readout}
        </span>
      )}

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Next take"
              disabled={disabled || isSwitching || atEnd}
              onClick={() => switchBy(1)}
            />
          }
        >
          <ChevronRight />
        </TooltipTrigger>
        <TooltipContent>Next take</TooltipContent>
      </Tooltip>
    </div>
  )
}
