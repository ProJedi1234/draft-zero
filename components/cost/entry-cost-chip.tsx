"use client"

import * as React from "react"
import { CircleDollarSign } from "lucide-react"

import { formatUsd, shortModelId } from "@/lib/format"
import { THINKING_LEVEL_LABELS, type StoryEntry } from "@/lib/types"
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

/** Grouped, exact — this is the audit line, not the glance. */
function grouped(count: number): string {
  return count.toLocaleString("en-US")
}

/**
 * The provenance lines, shared by the hover tooltip and the tapped popover so
 * the two can never drift into telling different stories about one passage.
 */
function CostDetail({ entry }: { entry: StoryEntry }) {
  const provenance = entry.generation
  // Aborted and errored calls are the ones OpenRouter most often never prices,
  // and "—" alone invites the reading that the app lost the number. Say why —
  // but only when it is true: a *settled* call with no price was simply never
  // priced, and blaming a stop that never happened is a worse answer than none.
  const stopped = entry.callStatus === "aborted" || entry.callStatus === "error"

  const promptTokens = provenance?.promptTokens ?? null
  const completionTokens = provenance?.completionTokens ?? null
  const hasTokens = promptTokens !== null || completionTokens !== null

  const tokenLine = hasTokens
    ? [
        promptTokens !== null ? `${grouped(promptTokens)} in` : null,
        completionTokens !== null ? `${grouped(completionTokens)} out` : null,
        // Zero reasoning tokens is the ordinary case for a non-thinking model
        // and says nothing; omitted rather than printed as "0 reasoning".
        entry.reasoningTokens
          ? `${grouped(entry.reasoningTokens)} reasoning`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null

  return (
    <>
      {/* A stopped call that OpenRouter *did* price still has a real number,
          and swallowing it behind "not recorded" would under-report the
          passage. So: the message only replaces the figure when there is no
          figure; otherwise it rides beside it. */}
      <span>
        {entry.costUsd !== null
          ? formatUsd(entry.costUsd)
          : stopped
            ? "cost not recorded — stopped mid-generation"
            : "cost not recorded"}
      </span>
      {entry.costUsd !== null && stopped && (
        <span className="opacity-70">stopped mid-generation</span>
      )}
      {tokenLine && <span className="opacity-70">{tokenLine}</span>}
      {provenance && (
        <span className="opacity-70">
          {shortModelId(provenance.modelId)}
          {" · thinking "}
          {THINKING_LEVEL_LABELS[provenance.thinking].toLowerCase()}
          {" · temp "}
          {provenance.temperature}
        </span>
      )}
      {entry.variantCount > 1 && (
        <span className="opacity-70">
          take {entry.variantIndex + 1} of {entry.variantCount}
        </span>
      )}
    </>
  )
}

/**
 * The per-passage cost readout, riding inside the passage's action cluster.
 *
 * Two things this had to stop doing. The cluster is only hover-hidden at `md`
 * and up — below that it is permanently visible, because touch has no hover to
 * give — so a bare figure in it meant a live dollar amount printed under every
 * generated passage on a phone. And it was a non-focusable <span> with a
 * hover-only tooltip, which put its provenance out of reach of both touch and
 * the keyboard. So: a real button, showing the figure only where the cluster
 * itself is hidden at rest and a bare "$" glyph everywhere else, answering to
 * hover with a tooltip and to tap or Enter with the same lines in a popover.
 *
 * Tri-state, and the third state matters: a user-authored passage renders
 * *nothing*, because a dash on a passage the writer typed reads as a broken
 * value rather than as "free". A generated passage with no recorded cost
 * renders "—" (via formatUsd), never "$0.00" — a stopped or unpriced call cost
 * something we do not know, and rounding an unknown to zero is a lie.
 */
export function EntryCostChip({ entry }: { entry: StoryEntry }) {
  const [open, setOpen] = React.useState(false)

  if (entry.source !== "generated") return null

  const figure = formatUsd(entry.costUsd)
  const label =
    entry.costUsd === null
      ? "Cost not recorded for this passage. Show details."
      : `This passage cost ${figure}. Show details.`

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
          <CostDetail entry={entry} />
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="end"
        className="w-auto max-w-[16rem] gap-0.5 p-3 font-mono text-[0.6875rem] leading-5 tabular-nums"
        aria-label="Passage cost"
      >
        <CostDetail entry={entry} />
      </PopoverContent>
    </Popover>
  )
}
