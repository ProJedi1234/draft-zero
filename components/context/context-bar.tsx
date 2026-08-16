"use client"

import type { ContextBreakdown } from "@/lib/generation/breakdown"
import type { ContextSectionId } from "@/lib/generation/types"
import { cn } from "@/lib/utils"

import { SECTION_SHADES } from "./section-shades"

/** Below this a band is invisible; it keeps a sliver instead of vanishing. */
const MIN_SEGMENT = "min-w-[3px]"

/**
 * The whole request as one bar: every section's share of the window, in the
 * order the model reads them, with the unclaimed remainder showing through as
 * track.
 *
 * Deliberately not labelled in place — a number on every band is unreadable at
 * this height, and the list underneath is the legend, direct-labelled and
 * reachable without a pointer. The bar's job is the shape: which band is eating
 * the window, and how much room is left.
 *
 * Widths are computed against the WINDOW, not against what was used, so a
 * half-empty context reads as half empty. When the context overshot the window
 * there is nothing left to show as free, and the bands are scaled to the
 * overshoot instead — the header carries the actual overflow in words.
 */
export function ContextBar({
  breakdown,
  activeId,
  onHover,
  className,
}: {
  breakdown: ContextBreakdown
  /** Section to lift out of the ramp, hover-linked with the list below. */
  activeId?: ContextSectionId | null
  onHover?: (id: ContextSectionId | null) => void
  className?: string
}) {
  const denominator = Math.max(breakdown.windowTokens, breakdown.usedTokens, 1)

  return (
    <div
      className={cn("flex h-2.5 w-full gap-[2px] bg-muted", className)}
      role="img"
      aria-label={`${breakdown.usedTokens.toLocaleString("en-US")} of ${breakdown.windowTokens.toLocaleString("en-US")} context tokens used`}
      onPointerLeave={() => onHover?.(null)}
    >
      {breakdown.sections.map((section) => (
        <div
          key={section.id}
          // The list below names every band; announcing them twice would make
          // the bar a second, worse copy of it.
          aria-hidden
          onPointerEnter={() => onHover?.(section.id)}
          className={cn(
            MIN_SEGMENT,
            SECTION_SHADES[section.id],
            "transition-opacity",
            // Dimming the others, rather than brightening this one, keeps every
            // band's own weight — and therefore its identity — unchanged.
            activeId != null && activeId !== section.id && "opacity-40"
          )}
          style={{ width: `${(section.tokens / denominator) * 100}%` }}
        />
      ))}
    </div>
  )
}
