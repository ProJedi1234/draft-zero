"use client"

import * as React from "react"

import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { formatContextLength } from "@/lib/format"
import {
  CONTEXT_WINDOWS,
  DEFAULT_CONTEXT_WINDOW,
  clampContextWindow,
  contextWindowLabel,
} from "@/lib/types"

const LABEL = "Context window"

/** Ladder index of a token count; an off-ladder value falls back to the default stop. */
function stopIndex(value: number): number {
  const stops = CONTEXT_WINDOWS as readonly number[]
  const found = stops.indexOf(value)
  return found === -1 ? stops.indexOf(DEFAULT_CONTEXT_WINDOW) : found
}

/** First element of Base UI's slider value, which is an array here (one thumb). */
function readIndex(next: number | readonly number[], fallback: number): number {
  return Array.isArray(next) ? (next[0] ?? fallback) : (next as number)
}

export interface ContextWindowSliderProps {
  /** Selected window in tokens. Always one of CONTEXT_WINDOWS. */
  value: number
  /** Selected model's window; 0 when the model is unknown to the catalog (no clamp). */
  contextLength: number
  /** Fires on every snap while dragging — local/optimistic only, never persisted. */
  onValueChange: (next: number) => void
  /**
   * Fires once on release with the settled stop. Persist here. Deliberately
   * fires even when the thumb landed back where it started: only the inspector
   * knows what the row actually holds (it also clamps the window on a model
   * switch, behind this component's back), so it owns the no-op check.
   */
  onValueCommitted: (next: number) => void
  /**
   * Pointer handlers from `useDragHold`, spread onto the slider. Owned by the
   * inspector because the gesture has to freeze more than this component knows
   * about — the ceiling as well as the value.
   */
  dragProps?: { onPointerDown: () => void }
}

/**
 * The context-window ladder as a snapping slider.
 *
 * A sibling of SettingSlider rather than a mode of it, for two reasons the
 * generic component cannot absorb without becoming a union of two widgets: the
 * thumb moves over ladder *indices* (0…n-1, step 1) while the persisted value is
 * the token count at that index, and the legal range shrinks with the selected
 * model — so the value has to be owned by the inspector, which is the only place
 * that knows the model, instead of being self-persisted from a storyId.
 *
 * Stops above the model's window are made unreachable simply by lowering `max`:
 * Base UI then blocks the drag and the arrow keys past it, so there is no
 * disabled-stop machinery to keep in sync.
 */
export function ContextWindowSlider({
  value,
  contextLength,
  onValueChange,
  onValueCommitted,
  dragProps,
}: ContextWindowSliderProps) {
  const maxIndex = stopIndex(
    clampContextWindow(
      CONTEXT_WINDOWS[CONTEXT_WINDOWS.length - 1],
      contextLength
    )
  )
  const index = Math.min(stopIndex(value), maxIndex)
  const clamped = maxIndex < CONTEXT_WINDOWS.length - 1

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs">{LABEL}</Label>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {contextWindowLabel(CONTEXT_WINDOWS[index])}
        </span>
      </div>
      <Slider
        value={[index]}
        min={0}
        max={maxIndex}
        step={1}
        onValueChange={(next) =>
          onValueChange(
            CONTEXT_WINDOWS[readIndex(next, index)] ?? DEFAULT_CONTEXT_WINDOW
          )
        }
        onValueCommitted={(next) =>
          onValueCommitted(
            CONTEXT_WINDOWS[readIndex(next, index)] ?? DEFAULT_CONTEXT_WINDOW
          )
        }
        aria-label={LABEL}
        {...dragProps}
      />
      {clamped ? (
        // Without this the ladder just stops short for no visible reason.
        <p className="text-xs text-muted-foreground">
          Limited by the model&apos;s {formatContextLength(contextLength)}{" "}
          window.
        </p>
      ) : null}
    </div>
  )
}
