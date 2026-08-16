"use client"

import * as React from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Meter } from "@/components/ui/meter"
import { Separator } from "@/components/ui/separator"
import type {
  ContextBreakdown,
  ContextItem,
  ContextSection,
} from "@/lib/generation/breakdown"
import type { ContextSectionId } from "@/lib/generation/types"
import { contextWindowLabel } from "@/lib/types"
import { cn } from "@/lib/utils"

import { ContextBar } from "./context-bar"
import { SECTION_SHADES } from "./section-shades"

/** Exact and grouped: this is the audit line, not the glance. */
function grouped(count: number): string {
  return count.toLocaleString("en-US")
}

/**
 * The context viewer's body: the headline numbers, the bar, and one row per
 * section that opens onto the exact text that was sent.
 *
 * Shared by both callers — the passage that was already generated and the
 * inspector's preview of the next one — because the two must never be able to
 * describe the same arithmetic differently. Only the caption above the bar
 * changes.
 */
export function ContextBreakdownView({
  breakdown,
  caption,
}: {
  breakdown: ContextBreakdown
  /** What this context IS: "Context used for this action", or the preview line. */
  caption: string
}) {
  const [hovered, setHovered] = React.useState<ContextSectionId | null>(null)

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm">{caption}</span>
          {/* "≈" because usedTokens is ceil(chars / 4), not a tokenizer's
              count — the cost chip beside this passage prints the provider's
              real figure, and the two must not both read as authoritative.
              The window goes through contextWindowLabel like every other
              surface that prints a selected stop. */}
          <span className="font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            ≈ {grouped(breakdown.usedTokens)} /{" "}
            {contextWindowLabel(breakdown.windowTokens)} tokens
          </span>
        </div>
        <ContextBar
          breakdown={breakdown}
          activeId={hovered}
          onHover={setHovered}
        />
        {breakdown.overflowing && (
          // The honest reading of a context the budget could not reach. It
          // happens: the system prompt, memory and author's note are all fixed
          // overhead, and at the small stops they can exceed the window on
          // their own. Saying nothing would leave a bar that is simply full.
          <p className="text-xs text-muted-foreground">
            Over the window by{" "}
            {grouped(breakdown.usedTokens - breakdown.windowTokens)} tokens —
            memory, the author&apos;s note and the instructions are sent whole
            and cannot be trimmed.
          </p>
        )}
      </div>

      <div>
        {breakdown.sections.map((section) => (
          <SectionRow
            key={section.id}
            section={section}
            dimmed={hovered !== null && hovered !== section.id}
            onHover={setHovered}
          />
        ))}
        {breakdown.freeTokens > 0 && (
          <>
            <Separator />
            <div className="flex items-center gap-3 py-3 text-muted-foreground">
              <span
                className="size-2 shrink-0 border border-current"
                aria-hidden
              />
              <span className="flex-1 text-sm">Unused</span>
              <span className="font-mono text-xs tabular-nums">
                {grouped(breakdown.freeTokens)}
              </span>
              {/* Keeps the row's numbers aligned with the ones above, which
                  each reserve this much for their chevron. */}
              <span className="size-3.5 shrink-0" aria-hidden />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SectionRow({
  section,
  dimmed,
  onHover,
}: {
  section: ContextSection
  dimmed: boolean
  onHover: (id: ContextSectionId | null) => void
}) {
  // Controlled rather than read off a data attribute: the chevron is the only
  // thing that needs the state, and owning it here beats guessing at the
  // primitive's open-state attribute names.
  const [open, setOpen] = React.useState(false)
  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Separator />
      <CollapsibleTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-3 py-3 text-left transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
              dimmed && "opacity-50"
            )}
            // Keyboard focus only, deliberately not hover: the link runs bar →
            // row, and making it run both ways means every pointer crossing the
            // list repaints the whole panel. Keyboard users have no bar to
            // point at, so focus is where they get the same answer — but a
            // mouse click focuses too, and latching the dimming for as long as
            // a writer reads an expanded row is not a hover link.
            onFocus={(event) => {
              if (event.target.matches(":focus-visible")) onHover(section.id)
            }}
            onBlur={() => onHover(null)}
          />
        }
      >
        <span
          className={cn("size-2 shrink-0", SECTION_SHADES[section.id])}
          aria-hidden
        />
        <span className="flex-1 text-sm">{section.label}</span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {grouped(section.tokens)}
        </span>
        <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 pb-4 pl-5">
          <p className="text-xs text-muted-foreground">{section.fitNote}</p>
          {section.fit !== null && <Meter value={section.fit} />}
          {section.items.length > 0 && (
            <ul className="space-y-1">
              {section.items.map((item) => (
                <LoreItemRow key={item.id} item={item} />
              ))}
            </ul>
          )}
          {/* The point of the whole feature: not a summary of what was sent,
              but the characters that were sent. Serif, because it is mostly
              manuscript, and pre-wrap because the paragraph breaks are part of
              what the model saw. Focusable because it scrolls: without a tab
              stop the text past the fold is mouse-only. */}
          {section.text.trim() !== "" && (
            <pre
              tabIndex={0}
              className="max-h-72 overflow-auto bg-muted/50 p-3 font-serif text-xs leading-6 whitespace-pre-wrap focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
            >
              {section.text.trim()}
            </pre>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** One lorebook entry that made it in, and why. */
function LoreItemRow({ item }: { item: ContextItem }) {
  return (
    <li className="flex items-baseline gap-3 text-xs">
      <span className="flex-1 truncate">{item.label}</span>
      <span className="truncate text-muted-foreground">
        {/* An always-active entry did not need a trigger, and printing a key it
            never matched would be a fabricated explanation. */}
        {item.matchedKey === null
          ? "always on"
          : `matched “${item.matchedKey}”`}
      </span>
      <span className="font-mono text-muted-foreground tabular-nums">
        {grouped(item.tokens)}
      </span>
    </li>
  )
}
