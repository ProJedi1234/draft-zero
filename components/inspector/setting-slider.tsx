"use client"

import * as React from "react"
import { toast } from "sonner"

import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { updateGenerationSettings } from "@/lib/actions/stories"
import type { GenerationSettings } from "@/lib/types"

/** The numeric generation-settings fields a slider can drive. */
export type SliderSettingField = {
  [K in keyof GenerationSettings]: GenerationSettings[K] extends number
    ? K
    : never
}[keyof GenerationSettings]

export interface SettingSliderProps {
  storyId: string
  /** Which generation setting this slider persists. */
  field: SliderSettingField
  label: string
  /** Initial value from the server. The slider is uncontrolled-after-mount (§4.2). */
  defaultValue: number
  min: number
  max: number
  step: number
  hint?: string
}

/** First element of Base UI's slider value, which is an array here (one thumb). */
function readValue(next: number | readonly number[], fallback: number): number {
  return Array.isArray(next) ? (next[0] ?? fallback) : (next as number)
}

/**
 * A labelled slider that tracks the drag locally and persists exactly once, on
 * commit (`onValueCommitted`) — never on every drag frame.
 */
export function SettingSlider({
  storyId,
  field,
  label,
  defaultValue,
  min,
  max,
  step,
  hint,
}: SettingSliderProps) {
  const [value, setValue] = React.useState(defaultValue)
  // Last value known to be persisted — keeps a commit without movement (a click
  // on the thumb, a re-commit of the same number) from hitting the database.
  const savedRef = React.useRef(defaultValue)
  const [, startTransition] = React.useTransition()

  function commit(next: number) {
    if (next === savedRef.current) return
    savedRef.current = next
    const patch: Partial<GenerationSettings> = {}
    patch[field] = next
    startTransition(async () => {
      const result = await updateGenerationSettings(storyId, patch)
      if (!result.ok) toast.error(result.error)
    })
  }

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
        onValueChange={(next) => setValue(readValue(next, min))}
        onValueCommitted={(next) => commit(readValue(next, min))}
        aria-label={label}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
