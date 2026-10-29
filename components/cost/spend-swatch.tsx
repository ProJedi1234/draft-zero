import { cn } from "@/lib/utils"
import { SPEND_PURPOSE_BY_PART } from "@/lib/spend-purpose"
import type { SpendPart, SpendPurpose } from "@/lib/types"

// Whole class names, so Tailwind can see every one it has to ship.
const FILL: Record<SpendPurpose, string> = {
  story: "bg-spend-story",
  pictures: "bg-spend-pictures",
  memory: "bg-spend-memory",
  atmosphere: "bg-spend-atmosphere",
}

const INK: Record<SpendPurpose, string> = {
  story: "text-spend-story",
  pictures: "text-spend-pictures",
  memory: "text-spend-memory",
  atmosphere: "text-spend-atmosphere",
}

/** Lines drawn striped in their purpose's colour rather than a hue of their own. */
const STRIPED: ReadonlySet<SpendPart> = new Set(["reroll", "recap"])

export function purposeFill(purpose: SpendPurpose): string {
  return FILL[purpose]
}

export function partFill(part: SpendPart): string {
  const purpose = SPEND_PURPOSE_BY_PART[part]
  return STRIPED.has(part) ? cn(INK[purpose], "bg-hatch") : FILL[purpose]
}

export function purposeInk(purpose: SpendPurpose): string {
  return INK[purpose]
}

/** The key beside a ledger line. `off` is a feature switched off, drawn as an empty outline. */
export function SpendSwatch({
  fill,
  off = false,
  className,
}: {
  fill?: string
  off?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 flex-none rounded-[2px]",
        off
          ? "outline outline-1 -outline-offset-1 outline-muted-foreground/60 outline-dashed"
          : fill,
        className
      )}
    />
  )
}
