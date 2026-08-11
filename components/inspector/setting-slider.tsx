"use client"

import { useState } from "react"

import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"

export interface SettingSliderProps {
  label: string
  defaultValue: number
  min: number
  max: number
  step: number
  hint?: string
}

export function SettingSlider({
  label,
  defaultValue,
  min,
  max,
  step,
  hint,
}: SettingSliderProps) {
  const [value, setValue] = useState(defaultValue)

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
        onValueChange={(next) =>
          setValue(Array.isArray(next) ? (next[0] ?? min) : (next as number))
        }
        aria-label={label}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
