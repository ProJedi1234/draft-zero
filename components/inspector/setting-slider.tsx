"use client"

import * as React from "react"
import { toast } from "sonner"

import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { useServerSyncedValue } from "@/hooks/use-server-synced"
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
  /** The stored value. Followed while mounted, except mid-drag or mid-save. */
  serverValue: number
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
 *
 * Between drags it follows the stored value, so a temperature changed on
 * another device shows up here without a reload. `dragging` is what keeps that
 * from yanking the thumb out from under a finger mid-gesture.
 */
export function SettingSlider({
  storyId,
  field,
  label,
  serverValue,
  min,
  max,
  step,
  hint,
}: SettingSliderProps) {
  const [dragging, setDragging] = React.useState(false)
  const { value, server, setLocal, write } = useServerSyncedValue(serverValue, {
    hold: dragging,
  })
  const [, startTransition] = React.useTransition()

  function commit(next: number) {
    // A commit without movement — a click on the thumb, a drag that ended where
    // it began — is what `server` catches, and what keeps it off the database.
    const changed = next !== server
    write(next)
    setDragging(false)
    if (!changed) return

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
        onValueChange={(next) => {
          setDragging(true)
          setLocal(readValue(next, min))
        }}
        onValueCommitted={(next) => commit(readValue(next, min))}
        aria-label={label}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
