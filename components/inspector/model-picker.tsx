"use client"

import { ModelCombobox } from "@/components/model-combobox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatContextLength } from "@/lib/format"
import {
  THINKING_LEVEL_LABELS,
  type OpenRouterModel,
  type ThinkingLevel,
} from "@/lib/types"

/**
 * Provider-grouped model select. Controlled by the inspector so the context
 * meter can size itself against the model the writer just picked; persistence
 * happens in `onValueChange` (immediate, never debounced — §4.4).
 *
 * The thinking dropdown sits directly under it and only exists for models the
 * catalog says can reason — it is the same setting, one model deep.
 */
export function ModelPicker({
  models,
  value,
  onValueChange,
  thinking,
  onThinkingChange,
}: {
  models: OpenRouterModel[]
  value: string
  onValueChange: (modelId: string) => void
  thinking: ThinkingLevel
  onThinkingChange: (thinking: ThinkingLevel) => void
}) {
  const selected = models.find((m) => m.id === value)
  const reasoning = selected?.reasoning ?? null
  // "off" is always offered: for a mandatory-reasoning model it means "don't
  // ask for a level", which the provider answers with its own default.
  const levels: ThinkingLevel[] = ["off", ...(reasoning?.efforts ?? [])]

  return (
    <div className="space-y-2">
      <Label>Model</Label>
      <ModelCombobox
        models={models}
        value={value}
        onValueChange={onValueChange}
      />
      {reasoning ? (
        <Select
          value={thinking}
          onValueChange={(next) => onThinkingChange(next as ThinkingLevel)}
          items={levels.map((level) => ({
            value: level,
            label: THINKING_LEVEL_LABELS[level],
          }))}
        >
          <SelectTrigger size="sm" className="w-full">
            <span className="text-muted-foreground">Thinking</span>
            <SelectValue className="flex-none" />
          </SelectTrigger>
          <SelectContent>
            {levels.map((level) => (
              <SelectItem key={level} value={level}>
                {THINKING_LEVEL_LABELS[level]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {selected ? (
        <p className="text-xs text-muted-foreground">
          In {selected.pricing.prompt} · Out {selected.pricing.completion} per
          1M · {formatContextLength(selected.contextLength)} context
        </p>
      ) : null}
    </div>
  )
}
