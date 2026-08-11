"use client"

import { ModelCombobox } from "@/components/model-combobox"
import { Label } from "@/components/ui/label"
import { formatContextLength } from "@/lib/format"
import type { OpenRouterModel } from "@/lib/types"

/**
 * Provider-grouped model select. Controlled by the inspector so the context
 * meter can size itself against the model the writer just picked; persistence
 * happens in `onValueChange` (immediate, never debounced — §4.4).
 */
export function ModelPicker({
  models,
  value,
  onValueChange,
}: {
  models: OpenRouterModel[]
  value: string
  onValueChange: (modelId: string) => void
}) {
  const selected = models.find((m) => m.id === value)

  return (
    <div className="space-y-2">
      <Label>Model</Label>
      <ModelCombobox
        models={models}
        value={value}
        onValueChange={onValueChange}
      />
      {selected ? (
        <p className="text-xs text-muted-foreground">
          In {selected.pricing.prompt} · Out {selected.pricing.completion} per
          1M · {formatContextLength(selected.contextLength)} context
        </p>
      ) : null}
    </div>
  )
}
