"use client"

import * as React from "react"
import { toast } from "sonner"

import { SliderField } from "@/components/slider-field"
import { useDragHold } from "@/hooks/use-drag-hold"
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

const FALLBACK_ERROR = "Couldn't save your changes."

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
  const { dragging, dragProps } = useDragHold()
  const { value, server, setLocal, write, settle, reset } =
    useServerSyncedValue(serverValue, { hold: dragging })
  const [, startTransition] = React.useTransition()

  function commit(next: number) {
    // A commit without movement — a click on the thumb, a drag that ended where
    // it began — is what `server` catches, and what keeps it off the database.
    const changed = next !== server
    const previous = server
    write(next)
    if (!changed) return

    const patch: Partial<GenerationSettings> = {}
    patch[field] = next
    startTransition(async () => {
      let ok = false
      let message = FALLBACK_ERROR
      try {
        const result = await updateGenerationSettings(storyId, patch)
        ok = result.ok
        if (!result.ok) message = result.error
      } catch (error) {
        message =
          error instanceof Error && error.message ? error.message : message
      }
      // Either way the wait for an echo is over. Leaving it on would strand
      // this slider on a value the database never took.
      if (ok) {
        settle()
      } else {
        reset(previous)
        toast.error(message)
      }
    })
  }

  return (
    <SliderField
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={setLocal}
      onValueCommitted={commit}
      hint={hint}
      dragProps={dragProps}
    />
  )
}
