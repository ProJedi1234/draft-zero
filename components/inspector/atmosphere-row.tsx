"use client"

import * as React from "react"
import { Sparkles } from "lucide-react"
import { toast } from "sonner"

import { SliderField } from "@/components/slider-field"
import { Label } from "@/components/ui/label"
import { useAtmosphereStatus } from "@/hooks/use-atmosphere-status"
import { useDragHold } from "@/hooks/use-drag-hold"
import { useServerSyncedValue } from "@/hooks/use-server-synced"
import { setStoryTintAuto, updateStoryTint } from "@/lib/actions/stories"
import { STORY_TINTS } from "@/lib/story-tint"
import type { AtmospherePhase } from "@/lib/sync/types"
import type { ActionResult, Story } from "@/lib/types"
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
 * about the story's atmosphere and belongs in the same row as the others. Auto
 * is in the row for the same reason: "let the story choose" is one of the
 * answers to the question the row asks, not a setting about the row.
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
  // A third channel for the same reason: the post-turn atmosphere call moves
  // hue and strength on its own, and the payload announcing that arrives while
  // a press of Auto here may still be in flight.
  const auto = useServerSyncedValue(story.tintAuto, {
    version: story.updatedAt,
  })

  // `onSettle` rather than settling every channel here: useServerSyncedValue
  // counts writes and wants exactly one settle per `write`, and only the caller
  // knows which of the three it actually wrote. A strength release that settled
  // the hue as well would drop a swatch press's count to zero while that write
  // was still travelling, handing the control back to payloads that predate it.
  //
  // The write itself is a thunk for the same reason the flag has its own
  // action: engaging Auto must not send a hue, so the two gestures cannot share
  // one call shape — only the error handling and the transition.
  function save(
    write: () => Promise<ActionResult>,
    onSettle: () => void,
    onFail: () => void
  ) {
    startTransition(async () => {
      let ok = false
      let message = FALLBACK_ERROR
      try {
        const result = await write()
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
    const previousAuto = auto.server
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
    // Pinning rides along on the same write rather than following it: a colour
    // pressed by hand and a flag saying so are one decision, and splitting them
    // leaves a window in which the next post-turn check could overrule a press
    // that has already happened.
    auto.write(false)
    save(
      () =>
        updateStoryTint(story.id, {
          hue: nextHue,
          strength: nextStrength,
          auto: false,
        }),
      () => {
        hue.settle()
        strength.settle()
        auto.settle()
      },
      () => {
        hue.reset(previousHue)
        strength.reset(previousStrength)
        auto.reset(previousAuto)
      }
    )
  }

  function commitStrength(next: number) {
    const previous = strength.server
    const changed = next !== previous
    strength.write(next)
    if (!changed) return
    save(
      () => updateStoryTint(story.id, { hue: hue.server, strength: next }),
      () => strength.settle(),
      () => strength.reset(previous)
    )
  }

  function engageAuto() {
    const previous = auto.server
    if (previous) return
    auto.write(true)
    save(
      () => setStoryTintAuto(story.id, true),
      () => auto.settle(),
      () => auto.reset(previous)
    )
  }

  const active = hue.value
  const engaged = auto.value
  const status = useAtmosphereStatus(story.id)

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
        <AutoSwatch
          engaged={engaged}
          phase={status?.phase ?? null}
          onSelect={engageAuto}
        />
        <TintSwatch
          label="No tint"
          selected={active === null}
          provisional={engaged}
          onSelect={() => pick(null, 1)}
        />
        {STORY_TINTS.map((tint) => (
          <TintSwatch
            key={tint.id}
            label={tint.label}
            hue={tint.hue}
            selected={active === tint.hue}
            provisional={engaged}
            onSelect={() => pick(tint.hue, tint.strength)}
          />
        ))}
      </div>
      {engaged ? (
        // No strength slider while the story is choosing: the next check would
        // move the number back, and a control whose value quietly reverts is
        // worse than one that isn't there. Pressing a swatch takes it back.
        <p className="text-xs text-muted-foreground">
          The story picks its own colour after each turn, as the scene moves.
          Press a swatch to keep the one it is wearing.
        </p>
      ) : active === null ? (
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

/**
 * The row's one non-colour position: hand the choice back to the model.
 *
 * A swatch-shaped button rather than a switch beside the row, because it is
 * mutually exclusive with the eight colours in exactly the way they are with
 * each other — and because the row is icon-only, a sparkle carries "chosen for
 * you" without a word of label in a panel that has room for none.
 */
function AutoSwatch({
  engaged,
  phase,
  onSelect,
}: {
  engaged: boolean
  /** Where the last check got to, or null if it hasn't run this session. */
  phase: AtmospherePhase | null
  onSelect: () => void
}) {
  const checking = phase === "checking"
  const stopped = phase === "stopped"
  const label = stopped
    ? "Auto: stopped after repeated failures — change the model in Settings"
    : checking
      ? "Auto: reading the scene…"
      : engaged
        ? "Auto: the story chooses its colour"
        : "Auto: let the story choose its colour"
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={engaged}
      title={label}
      aria-label={label}
      className={cn(
        "relative flex size-6 items-center justify-center border transition-[box-shadow,border-color,color]",
        stopped
          ? "border-destructive/60 text-destructive"
          : engaged
            ? "border-foreground text-foreground ring-2 ring-foreground/30"
            : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
      )}
    >
      <Sparkles className="size-3.5" />
      {/* A square that travels the swatch's own border rather than a ring
          around it: the row is six-pixel-gapped chips, and anything drawn
          outside this one's box lands on its neighbour. Purely decorative —
          the state is in the label above, which is what a screen reader gets. */}
      {checking ? (
        <span
          aria-hidden
          className="atmosphere-scan pointer-events-none absolute -inset-px border border-foreground/70"
        />
      ) : null}
    </button>
  )
}

function TintSwatch({
  label,
  hue,
  selected,
  provisional,
  onSelect,
}: {
  label: string
  /** Absent for the "no tint" swatch, which shows the neutral palette. */
  hue?: number
  selected: boolean
  /**
   * Selected, but by the model rather than by hand — drawn a shade quieter so
   * the row says which colour the story is wearing without claiming anyone
   * asked for it.
   */
  provisional: boolean
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
        !selected && "border-border hover:border-foreground/40",
        selected &&
          (provisional
            ? "border-foreground/50 ring-2 ring-foreground/15"
            : "border-foreground ring-2 ring-foreground/30")
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
