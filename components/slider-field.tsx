"use client"

import { RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"

/** First element of Base UI's slider value, which is an array here (one thumb). */
function readValue(next: number | readonly number[], fallback: number): number {
  return Array.isArray(next) ? (next[0] ?? fallback) : (next as number)
}

/**
 * Whether a field is showing its own value or the global default, and how to
 * get back. Shared by SliderField and ContextWindowSlider so the two read as
 * one row type in the profile editor; every other caller omits it entirely and
 * gets a plain labelled slider.
 */
export interface InheritProps {
  /** True while the field is showing the global default rather than its own value. */
  inherited?: boolean
  /** Present only on an overridden field; drops it back to the default. */
  onRevert?: () => void
}

/**
 * The label row of a settings slider: name on the left, readout on the right,
 * and between them whichever inherit affordance applies.
 *
 * An inherited field says so in words and dims; an overridden one offers the
 * way back and does not, so the two states are legible from the label alone
 * without any colour of their own.
 */
export function SliderFieldHeader({
  label,
  readout,
  inherited,
  onRevert,
}: { label: string; readout: string } & InheritProps) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <Label className="text-xs">{label}</Label>
        {inherited ? (
          <span className="font-mono text-[0.625rem] text-muted-foreground">
            default
          </span>
        ) : onRevert ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={`Reset ${label} to the default`}
            className="size-5 text-muted-foreground"
            onClick={onRevert}
          >
            <RotateCcw className="size-3" />
          </Button>
        ) : null}
      </div>
      <span className="font-mono text-xs text-muted-foreground tabular-nums">
        {readout}
      </span>
    </div>
  )
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
  inherited,
  onRevert,
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
} & InheritProps) {
  return (
    // Dimmed rather than disabled: the writer takes an inherited field over by
    // dragging it, so the control has to stay live while it reads as not-its-own.
    <div className={cn("space-y-2", inherited && "opacity-50")}>
      <SliderFieldHeader
        label={label}
        readout={step < 1 ? value.toFixed(2) : value.toLocaleString("en-US")}
        inherited={inherited}
        onRevert={onRevert}
      />
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
