import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The one bar shape this app owns: a 2px monochrome track with a filled head.
 *
 * It exists as a component because it had drifted into three: the inspector's
 * context meter (bg-muted track, bg-primary fill), the ledger's model share
 * (bg-foreground/15 track, bg-foreground fill) and the usage page's (bg-muted
 * track, bg-foreground/25 fill). One feature, three weights — which reads as
 * three different kinds of measurement rather than one. The inspector's was the
 * original and is the one kept.
 *
 * `value` is a fraction, clamped here rather than at every call site: a share
 * of a total is arithmetic that can hand back NaN (0/0) or overshoot (a meter
 * whose stop is smaller than what it measures), and a bar wider than its own
 * track is a rendering bug rather than an honest reading.
 */
function Meter({
  value,
  className,
  indicatorClassName,
  ...props
}: React.ComponentProps<"div"> & {
  /** 0–1. Anything outside that, or not a number at all, reads as empty/full. */
  value: number
  indicatorClassName?: string
}) {
  const ratio = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0

  return (
    <div
      data-slot="meter"
      className={cn("h-0.5 w-full overflow-hidden bg-muted", className)}
      {...props}
    >
      <div
        className={cn("h-full bg-primary", indicatorClassName)}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  )
}

export { Meter }
