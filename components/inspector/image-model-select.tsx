"use client"

import * as React from "react"
import { ChevronsUpDownIcon } from "lucide-react"

import type { OpenRouterImageModel } from "@/lib/types"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface ProviderGroup {
  provider: string
  models: OpenRouterImageModel[]
}

/** Group by provider, preserving the order they arrive in. Mirrors ModelCombobox. */
function groupByProvider(models: OpenRouterImageModel[]): ProviderGroup[] {
  const groups: ProviderGroup[] = []
  for (const model of models) {
    const existing = groups.find((g) => g.provider === model.provider)
    if (existing) existing.models.push(model)
    else groups.push({ provider: model.provider, models: [model] })
  }
  return groups
}

/**
 * Which image model this story draws with — searchable, provider-grouped, and
 * deliberately the same control as the text model picker two rows above it.
 *
 * It was a plain select first, on the reasoning that a few dozen image models is
 * not enough to search through. That was wrong twice over: the live catalog
 * carries 43 and growing, which is well past scanning by eye, and a picker that
 * behaves differently from the identical-looking one beside it reads as broken
 * rather than as simplified.
 *
 * Under a zero-data-retention policy the treatment is the text combobox's,
 * verbatim: the models no retention-free endpoint serves leave their provider
 * groups and collect at the bottom, greyed and unselectable. The numbers are
 * why this matters more here than there — 12 of the live catalog's 48 image
 * models have a ZDR endpoint, so without the partition three quarters of the
 * list is pickable rows that every generation bounces off with a 404.
 *
 * It sits outside the profile branch above, because an image model is not part
 * of a model profile — a story following one still has to be able to choose.
 */
export function ImageModelSelect({
  models,
  value,
  price,
  zdr,
  onValueChange,
}: {
  models: OpenRouterImageModel[]
  /** The story's own choice, or null to follow the catalog's first entry. */
  value: string | null
  /**
   * What the SELECTED model costs per image, or null when unknown. Read on the
   * server for that one model — the catalog's list carries no pricing, so a
   * price per row would be one request per row.
   */
  price: string | null
  /** The story's effective retention policy — its own switch or the app floor. */
  zdr: boolean
  onValueChange: (modelId: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const allowed = zdr ? models.filter((model) => model.zdr) : models
  const blocked = zdr ? models.filter((model) => !model.zdr) : []
  const providers = groupByProvider(allowed)

  // Null is "follow the catalog" — resolved for display rather than shown as a
  // blank or an "Auto" row, since nothing here makes the routing decision that
  // "Auto" would imply. Under a ZDR policy the catalog's first ELIGIBLE entry,
  // matching what resolveImageModelId will actually send.
  const resolved = value ?? allowed[0]?.id ?? models[0]?.id ?? ""
  const selected = models.find((model) => model.id === resolved)

  return (
    <div className="space-y-2">
      <Label htmlFor="image-model">Image model</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id="image-model"
              variant="outline"
              className="w-full justify-between font-normal normal-case"
            />
          }
        >
          {/* A stored id the catalog no longer lists still shows, as its bare
              id. Silently falling back to another model would redraw the story
              in something the writer never picked. */}
          <span className="flex-1 truncate text-left">
            {selected?.name ?? resolved}
          </span>
          <ChevronsUpDownIcon className="opacity-50" />
        </PopoverTrigger>
        <PopoverContent className="w-(--anchor-width) p-0" sideOffset={4}>
          <Command>
            <CommandInput placeholder="Search image models…" />
            <CommandList>
              <CommandEmpty>No image model found.</CommandEmpty>
              {providers.map(({ provider, models: providerModels }) => (
                <CommandGroup key={provider} heading={provider}>
                  {providerModels.map((model) => (
                    <CommandItem
                      key={model.id}
                      // Searchable by lab as well as name: "flux" and "black
                      // forest" should both find FLUX, and for images the lab
                      // is most of what the choice means.
                      value={`${model.name} ${provider}`}
                      data-checked={model.id === resolved}
                      onSelect={() => {
                        onValueChange(model.id)
                        setOpen(false)
                      }}
                    >
                      <span className="flex-1 truncate">{model.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
              {blocked.length > 0 ? (
                // Kept rather than filtered away, exactly like the text
                // combobox's blocked rows: a model that vanished from the list
                // reads as a missing model, and the writer goes looking for it
                // in a search box that no longer has it.
                <CommandGroup heading="No zero-retention provider">
                  {blocked.map((model) => (
                    <CommandItem
                      key={model.id}
                      value={`${model.name} ${model.provider}`}
                      disabled
                    >
                      <span className="flex-1 truncate">{model.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {model.provider}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {/* Priced per image or per megapixel, not per token — the text picker's
          per-1M line would be the wrong unit, so this is its own footnote.
          Absent when the price is unknown; a zero would read as free. */}
      {price && (
        <p className="text-xs text-muted-foreground tabular-nums">{price}</p>
      )}
    </div>
  )
}
