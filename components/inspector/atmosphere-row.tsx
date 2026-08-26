"use client"

import * as React from "react"
import { toast } from "sonner"

import { SliderField } from "@/components/slider-field"
import { Label } from "@/components/ui/label"
import { useDragHold } from "@/hooks/use-drag-hold"
import { useServerSyncedValue } from "@/hooks/use-server-synced"
import { updateStoryTint } from "@/lib/actions/stories"
import { STORY_TINTS } from "@/lib/story-tint"
import type { Story } from "@/lib/types"
import { cn } from "@/lib/utils"

const FALLBACK_ERROR = "Couldn't save your changes."

/**
 * The story's atmosphere: a hue, and how far the room travels toward it.
 *
 * In the prompt section rather than a segment of its own, next to Memory and
 * the author's note: like them it is a property of this story that changes how
 * it feels to be in, and unlike the model settings it is not a knob anyone
 * tunes twice. The swatches are named points in the tint space, not presets —
 * the story stores the two numbers behind whichever one is pressed, so a hue
 * from anywhere else (a slider, a model) needs no new machinery.
 *
 * Off is a swatch rather than a clear button, because "untinted" is a choice
 * about the story's atmosphere and belongs in the same row as the others.
 */
export function AtmosphereRow({ story }: { story: Story }) {
  const uid = React.useId()
  const [, startTransition] = React.useTransition()
  const { dragging, dragProps } = useDragHold()

  // Hue and strength follow the server independently: they are written by
  // different gestures, and a swatch press must not be held hostage by a
  // slider drag that is still resolving. Versioned on the story's updatedAt so
  // a payload rendered before this device's own write cannot roll either back
  // — see hooks/use-server-synced.ts.
  const hue = useServerSyncedValue(story.tintHue, { version: story.updatedAt })
  const strength = useServerSyncedValue(story.tintStrength, {
    hold: dragging,
    version: story.updatedAt,
  })

  // `onSettle` rather than settling both channels here: useServerSyncedValue
  // counts writes and wants exactly one settle per `write`, and only the caller
  // knows which of the two it actually wrote. A strength release that settled
  // the hue as well would drop a swatch press's count to zero while that write
  // was still travelling, handing the control back to payloads that predate it.
  function save(
    nextHue: number | null,
    nextStrength: number,
    onSettle: () => void,
    onFail: () => void
  ) {
    startTransition(async () => {
      let ok = false
      let message = FALLBACK_ERROR
      try {
        const result = await updateStoryTint(story.id, {
          hue: nextHue,
          strength: nextStrength,
        })
        ok = result.ok
        if (!result.ok) message = result.error
      } catch (error) {
        message =
          error instanceof Error && error.message ? error.message : message
      }
      if (ok) {
        onSettle()
      } else {
        onFail()
        toast.error(message)
      }
    })
  }

  function pick(nextHue: number | null, recommended: number) {
    const previousHue = hue.server
    const previousStrength = strength.server
    // The swatch carries its own recommended strength, so pressing one is a
    // complete answer rather than the first half of one. A story that has been
    // tuned away from the recommendation keeps its number: re-pressing the
    // swatch it is already on would otherwise silently discard the tuning.
    const nextStrength =
      nextHue !== null && nextHue === previousHue
        ? previousStrength
        : recommended
    hue.write(nextHue)
    strength.write(nextStrength)
    save(
      nextHue,
      nextStrength,
      () => {
        hue.settle()
        strength.settle()
      },
      () => {
        hue.reset(previousHue)
        strength.reset(previousStrength)
      }
    )
  }

  function commitStrength(next: number) {
    const previous = strength.server
    const changed = next !== previous
    strength.write(next)
    if (!changed) return
    save(
      hue.server,
      next,
      () => strength.settle(),
      () => strength.reset(previous)
    )
  }

  const active = hue.value

  return (
    <div className="space-y-2">
      <Label id={`${uid}-label`}>Atmosphere</Label>
      {/* A group, so the label and the note below are announced once for the
          row rather than the note drifting loose in the panel — a <label> with
          no control and a describedby with no describee name nothing. */}
      <div
        role="group"
        aria-labelledby={`${uid}-label`}
        aria-describedby={`${uid}-desc`}
        className="flex flex-wrap gap-1.5"
      >
        <TintSwatch
          label="No tint"
          selected={active === null}
          onSelect={() => pick(null, 1)}
        />
        {STORY_TINTS.map((tint) => (
          <TintSwatch
            key={tint.id}
            label={tint.label}
            hue={tint.hue}
            selected={active === tint.hue}
            onSelect={() => pick(tint.hue, tint.strength)}
          />
        ))}
      </div>
      {active === null ? (
        <p className="text-xs text-muted-foreground">
          The room takes the story&apos;s colour. Light and dark each render it
          their own way.
        </p>
      ) : (
        <div className="pt-1">
          <SliderField
            label="Strength"
            value={strength.value}
            min={0}
            max={1}
            step={0.05}
            onValueChange={strength.setLocal}
            onValueCommitted={commitStrength}
            dragProps={dragProps}
            formatReadout={(value) => `${Math.round(value * 100)}%`}
            hint="How far the palette travels toward the hue."
          />
        </div>
      )}
      <span className="sr-only" id={`${uid}-desc`}>
        Sets this story&apos;s colour. Applies in both light and dark mode.
      </span>
    </div>
  )
}

function TintSwatch({
  label,
  hue,
  selected,
  onSelect,
}: {
  label: string
  /** Absent for the "no tint" swatch, which shows the neutral palette. */
  hue?: number
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={label}
      aria-label={label}
      className={cn(
        "tint-swatch size-6 border transition-[box-shadow,border-color]",
        selected
          ? "border-foreground ring-2 ring-foreground/30"
          : "border-border hover:border-foreground/40"
      )}
      style={
        {
          "--swatch-h": hue ?? 0,
          // Zero chroma is what makes the "no tint" swatch a grey chip using
          // the same rule as every other one, rather than a special case.
          "--swatch-c": hue === undefined ? 0 : 1,
        } as React.CSSProperties
      }
    />
  )
}
