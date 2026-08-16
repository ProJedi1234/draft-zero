"use client"

import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"

/** First element of Base UI's slider value, which is an array here (one thumb). */
function readValue(next: number | readonly number[], fallback: number): number {
  return Array.isArray(next) ? (next[0] ?? fallback) : (next as number)
}

/**
 * A labelled slider with its value read out beside the label — the shape every
 * generation setting is edited in, with no opinion about where the value lives.
 *
 * Presentation only, because the two callers persist on opposite schedules: the
 * inspector's SettingSlider saves each release to the story, while the profile
 * editor holds a draft until the writer hits save. Sharing the widget is what
 * keeps a temperature slider identical in both places.
 */
export function SliderField({
  label,
  value,
  min,
  max,
  step,
  onValueChange,
  onValueCommitted,
  hint,
  dragProps,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  /** Every frame of the drag. */
  onValueChange: (next: number) => void
  /** Once on release, with the settled value. */
  onValueCommitted?: (next: number) => void
  hint?: string
  /** Pointer handlers from `useDragHold`, for callers that follow the server. */
  dragProps?: { onPointerDown: () => void }
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {step < 1 ? value.toFixed(2) : value.toLocaleString("en-US")}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) => onValueChange(readValue(next, min))}
        onValueCommitted={(next) => onValueCommitted?.(readValue(next, min))}
        aria-label={label}
        {...dragProps}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
