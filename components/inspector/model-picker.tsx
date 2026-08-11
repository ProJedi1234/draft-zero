"use client"

import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatContextLength } from "@/lib/format"
import type { OpenRouterModel } from "@/lib/types"

interface ProviderGroup {
  provider: string
  models: OpenRouterModel[]
}

/** Group models by provider, preserving the order they appear in the array. */
function groupByProvider(models: OpenRouterModel[]): ProviderGroup[] {
  const groups: ProviderGroup[] = []
  for (const model of models) {
    const existing = groups.find((g) => g.provider === model.provider)
    if (existing) {
      existing.models.push(model)
    } else {
      groups.push({ provider: model.provider, models: [model] })
    }
  }
  return groups
}

export function ModelPicker({
  models,
  defaultModelId,
}: {
  models: OpenRouterModel[]
  defaultModelId: string
}) {
  const providers = groupByProvider(models)
  const selected = models.find((m) => m.id === defaultModelId)

  return (
    <div className="space-y-2">
      <Label>Model</Label>
      <Select
        defaultValue={defaultModelId}
        items={models.map((m) => ({ value: m.id, label: m.name }))}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {providers.map(({ provider, models: providerModels }) => (
            <SelectGroup key={provider}>
              <SelectLabel>{provider}</SelectLabel>
              {providerModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  <span className="flex-1 truncate">{m.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {formatContextLength(m.contextLength)}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {selected ? (
        <p className="text-xs text-muted-foreground">
          In {selected.pricing.prompt} · Out {selected.pricing.completion} per
          1M · {formatContextLength(selected.contextLength)} context
        </p>
      ) : null}
    </div>
  )
}
