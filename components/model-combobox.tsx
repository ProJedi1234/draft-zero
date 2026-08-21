"use client"

import { useState } from "react"
import { ChevronsUpDownIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { formatContextLength } from "@/lib/format"
import type { OpenRouterModel } from "@/lib/types"

interface ProviderGroup {
  provider: string
  models: OpenRouterModel[]
}

/**
 * Which models a data policy leaves pickable, and which it rules out. Under no
 * policy nothing is ruled out and `blocked` is empty.
 */
function partitionByPolicy(
  models: OpenRouterModel[],
  zdr: boolean
): { allowed: OpenRouterModel[]; blocked: OpenRouterModel[] } {
  if (!zdr) return { allowed: models, blocked: [] }
  return {
    allowed: models.filter((m) => m.zdr),
    blocked: models.filter((m) => !m.zdr),
  }
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

/**
 * Provider-grouped, searchable model select shared by the inspector and
 * settings.
 *
 * Under a zero-data-retention policy the models no ZDR endpoint serves leave
 * their provider groups and collect at the bottom, greyed and unselectable.
 * They are kept rather than filtered away for the reason the provider menu
 * keeps its blocked rows: a model that vanished from the list would read as a
 * missing model, and the writer would go looking for it in a search box that no
 * longer has it.
 */
export function ModelCombobox({
  id,
  models,
  value,
  onValueChange,
  zdr = false,
  onOpenChange,
  disabled,
  placeholder = "Select model…",
}: {
  id?: string
  models: OpenRouterModel[]
  value: string
  onValueChange: (modelId: string) => void
  /** Effective retention policy: on, only models with a ZDR endpoint are pickable. */
  zdr?: boolean
  /** Reported so a caller can hold off server-driven changes while this is open. */
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const { allowed, blocked } = partitionByPolicy(models, zdr)
  const providers = groupByProvider(allowed)
  const selected = models.find((m) => m.id === value)

  function changeOpen(next: boolean) {
    setOpen(next)
    onOpenChange?.(next)
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            disabled={disabled}
            className="w-full justify-between font-normal normal-case"
          />
        }
      >
        <span className="flex-1 truncate text-left">
          {selected?.name ?? placeholder}
        </span>
        <ChevronsUpDownIcon className="opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) p-0" sideOffset={4}>
        <Command>
          <CommandInput placeholder="Search models…" />
          <CommandList>
            <CommandEmpty>No model found.</CommandEmpty>
            {providers.map(({ provider, models: providerModels }) => (
              <CommandGroup key={provider} heading={provider}>
                {providerModels.map((m) => (
                  <ModelRow
                    key={m.id}
                    model={m}
                    provider={provider}
                    checked={m.id === value}
                    onSelect={() => {
                      onValueChange(m.id)
                      changeOpen(false)
                    }}
                  />
                ))}
              </CommandGroup>
            ))}
            {blocked.length > 0 ? (
              <CommandGroup heading="No zero-retention provider">
                {blocked.map((m) => (
                  <ModelRow
                    key={m.id}
                    model={m}
                    provider={m.provider}
                    checked={false}
                    blocked
                  />
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * One model row. `blocked` is a model the current data policy rules out —
 * greyed and unselectable, still searchable, still saying which provider it
 * belongs to.
 */
function ModelRow({
  model,
  provider,
  checked,
  blocked = false,
  onSelect,
}: {
  model: OpenRouterModel
  provider: string
  checked: boolean
  blocked?: boolean
  onSelect?: () => void
}) {
  return (
    <CommandItem
      value={`${model.name} ${provider}`}
      data-checked={checked}
      disabled={blocked}
      onSelect={onSelect}
    >
      <span className="flex-1 truncate">{model.name}</span>
      <span
        className={cn(
          "ml-2 text-xs text-muted-foreground",
          checked && "mr-1.5"
        )}
      >
        {formatContextLength(model.contextLength)}
      </span>
    </CommandItem>
  )
}
