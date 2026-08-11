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

/** Provider-grouped, searchable model select shared by the inspector and settings. */
export function ModelCombobox({
  id,
  models,
  value,
  onValueChange,
  disabled,
  placeholder = "Select model…",
}: {
  id?: string
  models: OpenRouterModel[]
  value: string
  onValueChange: (modelId: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const providers = groupByProvider(models)
  const selected = models.find((m) => m.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
                  <CommandItem
                    key={m.id}
                    value={`${m.name} ${provider}`}
                    data-checked={m.id === value}
                    onSelect={() => {
                      onValueChange(m.id)
                      setOpen(false)
                    }}
                  >
                    <span className="flex-1 truncate">{m.name}</span>
                    <span
                      className={cn(
                        "ml-2 text-xs text-muted-foreground",
                        m.id === value && "mr-1.5"
                      )}
                    >
                      {formatContextLength(m.contextLength)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
