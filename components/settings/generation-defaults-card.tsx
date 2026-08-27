"use client"

import * as React from "react"
import { toast } from "sonner"

import { ContextWindowSlider } from "@/components/inspector/context-window-slider"
import { SliderField } from "@/components/slider-field"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useDragHold } from "@/hooks/use-drag-hold"
import { useServerSyncedValue } from "@/hooks/use-server-synced"
import { updateGenerationDefaults } from "@/lib/actions/settings"
import {
  CONTEXT_WINDOWS,
  LORE_BUDGET_MAX,
  LORE_BUDGET_MIN,
  LORE_BUDGET_STEP,
  type GenerationDefaults,
} from "@/lib/types"

const FALLBACK_ERROR = "Couldn't save the defaults."

/** Percentages read as percentages; a bare "25" beside a slider is ambiguous. */
const formatPercent = (value: number) => `${value}%`

/**
 * The sampling every profile falls back to, field by field.
 *
 * Sliders only, and deliberately: model, provider and thinking are what makes
 * one profile different from another, so they have no global to fall back to.
 * These six do — a writer tunes temperature once and every profile that never
 * disagreed with it moves.
 */
export function GenerationDefaultsCard({
  defaults,
}: {
  defaults: GenerationDefaults
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Generation defaults</CardTitle>
        <CardDescription>
          Sampling every profile inherits unless it sets its own. Changing one
          moves every profile that hasn&apos;t overridden it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <DefaultSlider
          field="temperature"
          label="Temperature"
          serverValue={defaults.temperature}
          min={0}
          max={2}
          step={0.01}
        />
        <DefaultSlider
          field="topP"
          label="Top P"
          serverValue={defaults.topP}
          min={0}
          max={1}
          step={0.01}
        />
        <DefaultContextWindow serverValue={defaults.contextWindow} />
        <DefaultSlider
          field="loreBudget"
          label="Lore budget"
          serverValue={defaults.loreBudget}
          min={LORE_BUDGET_MIN}
          max={LORE_BUDGET_MAX}
          step={LORE_BUDGET_STEP}
          formatReadout={formatPercent}
          hint="Share of the free context the lorebook may claim. Whatever it doesn't spend goes to story prose."
        />
        <DefaultSlider
          field="frequencyPenalty"
          label="Frequency penalty"
          serverValue={defaults.frequencyPenalty}
          min={-2}
          max={2}
          step={0.1}
        />
        <DefaultSlider
          field="presencePenalty"
          label="Presence penalty"
          serverValue={defaults.presencePenalty}
          min={-2}
          max={2}
          step={0.1}
        />
      </CardContent>
    </Card>
  )
}

/**
 * The shared half of the two controls below: hold the drag locally, persist
 * once on release, and fall back to the previous server value if the write is
 * refused. A sibling of the inspector's SettingSlider, which does the same for
 * one story's columns.
 */
function useDefaultField(field: keyof GenerationDefaults, serverValue: number) {
  const { dragging, dragProps } = useDragHold()
  const { value, server, setLocal, write, settle, reset } =
    useServerSyncedValue(serverValue, { hold: dragging })
  const [, startTransition] = React.useTransition()

  function commit(next: number) {
    const changed = next !== server
    const previous = server
    write(next)
    if (!changed) return

    startTransition(async () => {
      let ok = false
      let message = FALLBACK_ERROR
      try {
        const result = await updateGenerationDefaults({ [field]: next })
        ok = result.ok
        if (!result.ok) message = result.error
      } catch (error) {
        message =
          error instanceof Error && error.message ? error.message : message
      }
      if (ok) {
        settle()
      } else {
        reset(previous)
        toast.error(message)
      }
    })
  }

  return { value, setLocal, commit, dragProps }
}

function DefaultSlider({
  field,
  label,
  serverValue,
  min,
  max,
  step,
  formatReadout,
  hint,
}: {
  field: keyof GenerationDefaults
  label: string
  serverValue: number
  min: number
  max: number
  step: number
  formatReadout?: (value: number) => string
  hint?: string
}) {
  const { value, setLocal, commit, dragProps } = useDefaultField(
    field,
    serverValue
  )
  return (
    <SliderField
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={setLocal}
      onValueCommitted={commit}
      formatReadout={formatReadout}
      hint={hint}
      dragProps={dragProps}
    />
  )
}

/**
 * The whole ladder is offered, because this default is not attached to a model:
 * the per-model ceiling is applied where a model is known — the inspector and
 * the profile editor both clamp what they show and send.
 */
const NO_MODEL_CEILING = CONTEXT_WINDOWS[CONTEXT_WINDOWS.length - 1]

function DefaultContextWindow({ serverValue }: { serverValue: number }) {
  const { value, setLocal, commit, dragProps } = useDefaultField(
    "contextWindow",
    serverValue
  )
  return (
    <ContextWindowSlider
      value={value}
      contextLength={NO_MODEL_CEILING}
      onValueChange={setLocal}
      onValueCommitted={commit}
      dragProps={dragProps}
    />
  )
}
