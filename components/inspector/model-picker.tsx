"use client"

import { ModelCombobox } from "@/components/model-combobox"
import { ProviderCombobox } from "@/components/provider-combobox"
import { ThinkingSelect } from "@/components/thinking-select"
import { Label } from "@/components/ui/label"
import { formatContextLength } from "@/lib/format"
import {
  endpointForTag,
  type ModelEndpoint,
  type OpenRouterModel,
  type ThinkingLevel,
} from "@/lib/types"

/**
 * Provider-grouped model select. Controlled by the inspector so the context
 * meter can size itself against the model the writer just picked; persistence
 * happens in `onValueChange` (immediate, never debounced — §4.4).
 *
 * Underneath sit the two settings that only mean anything one model deep: which
 * upstream endpoint serves it, and how hard it thinks. The footnote reports the
 * price and window of whatever will actually serve the request — the pinned
 * endpoint's numbers when there is one, the model's own under Auto, because on a
 * multi-provider model those are frequently not the same numbers.
 */
export function ModelPicker({
  models,
  value,
  onValueChange,
  endpoints,
  providerTag,
  onProviderTagChange,
  thinking,
  onThinkingChange,
}: {
  models: OpenRouterModel[]
  value: string
  onValueChange: (modelId: string) => void
  /** Endpoints serving the selected model, fastest first; [] while loading. */
  endpoints: ModelEndpoint[]
  providerTag: string | null
  onProviderTagChange: (providerTag: string | null) => void
  thinking: ThinkingLevel
  onThinkingChange: (thinking: ThinkingLevel) => void
}) {
  const selected = models.find((m) => m.id === value)
  const endpoint = endpointForTag(endpoints, providerTag)
  const pricing = endpoint?.pricing ?? selected?.pricing
  const contextLength = endpoint?.contextLength ?? selected?.contextLength

  return (
    <div className="space-y-2">
      <Label>Model</Label>
      <ModelCombobox
        models={models}
        value={value}
        onValueChange={onValueChange}
      />
      <ProviderCombobox
        endpoints={endpoints}
        value={providerTag}
        onValueChange={onProviderTagChange}
      />
      <ThinkingSelect
        reasoning={selected?.reasoning ?? null}
        value={thinking}
        onValueChange={onThinkingChange}
      />
      {pricing && contextLength !== undefined ? (
        <p className="text-xs text-muted-foreground">
          In {pricing.prompt} · Out {pricing.completion} per 1M ·{" "}
          {formatContextLength(contextLength)} context
        </p>
      ) : null}
    </div>
  )
}
