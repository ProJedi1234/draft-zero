"use client"

import { useState, type ReactNode } from "react"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useModelSource, type ModelSource } from "@/hooks/use-model-source"
import { cn } from "@/lib/utils"
import { formatContextLength } from "@/lib/format"
import type {
  DecisionModel,
  LocalModelInfo,
  OpenRouterModel,
} from "@/lib/types"

/** The fields every catalog entry a picker lists has in common. */
interface CatalogEntry {
  id: string
  name: string
  provider: string
  contextLength: number
  zdr: boolean
  local?: LocalModelInfo
}

interface ProviderGroup<T> {
  provider: string
  models: T[]
}

/**
 * Which models a data policy leaves pickable, and which it rules out. Under no
 * policy nothing is ruled out and `blocked` is empty.
 */
function partitionByPolicy<T extends CatalogEntry>(
  models: T[],
  zdr: boolean
): { allowed: T[]; blocked: T[] } {
  if (!zdr) return { allowed: models, blocked: [] }
  return {
    allowed: models.filter((m) => m.zdr),
    blocked: models.filter((m) => !m.zdr),
  }
}

/** Group models by provider, preserving the order they appear in the array. */
function groupByProvider<T extends CatalogEntry>(
  models: T[]
): ProviderGroup<T>[] {
  const groups: ProviderGroup<T>[] = []
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

function bySource<T extends CatalogEntry>(models: T[], source: ModelSource) {
  if (source === "local") return models.filter((m) => m.local)
  if (source === "external") return models.filter((m) => !m.local)
  return models
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
export function ModelCombobox(props: {
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
  return (
    <CatalogCombobox
      {...props}
      searchPlaceholder="Search models or providers…"
      detail={(model) => (
        <span className="ml-2 text-xs text-muted-foreground">
          {formatContextLength(model.contextLength)}
        </span>
      )}
      localDetail={(model) =>
        [
          formatContextLength(model.contextLength),
          model.reasoning ? "thinks" : null,
        ]
          .filter(Boolean)
          .join(" · ")
      }
    />
  )
}

/**
 * The atmosphere check's decision model. Same picker, priced per input token
 * only, because decision models bill no output.
 */
export function DecisionModelCombobox(props: {
  id?: string
  models: DecisionModel[]
  value: string
  onValueChange: (modelId: string) => void
  zdr?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
  /** The local host's label, for the empty Local group; null when there is none. */
  localHost: string | null
}) {
  const { localHost, ...rest } = props
  return (
    <CatalogCombobox
      {...rest}
      searchPlaceholder="Search decision models…"
      detail={(model) => (
        <span className="ml-2 flex flex-col items-end text-xs text-muted-foreground">
          <span>{model.promptPrice}</span>
          <span>
            {[
              model.contextLength > 0
                ? formatContextLength(model.contextLength)
                : null,
              model.inputModalities.includes("image") ? "image" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      )}
      localDetail={(model) =>
        model.contextLength > 0 ? formatContextLength(model.contextLength) : ""
      }
      emptyLocal={
        localHost ? (
          <p className="mx-2 my-1 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            No decision models on {localHost} yet. Pull one with{" "}
            <code className="font-mono">ollama pull tev1</code> or{" "}
            <code className="font-mono">ollama pull nimble</code>.
          </p>
        ) : null
      }
    />
  )
}

function CatalogCombobox<T extends CatalogEntry>({
  id,
  models,
  value,
  onValueChange,
  zdr = false,
  onOpenChange,
  disabled,
  placeholder = "Select model…",
  searchPlaceholder,
  detail,
  localDetail,
  emptyLocal = null,
}: {
  id?: string
  models: T[]
  value: string
  onValueChange: (modelId: string) => void
  zdr?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
  placeholder?: string
  searchPlaceholder: string
  /** Right-hand side of an OpenRouter row. */
  detail: (model: T) => ReactNode
  /** What follows "loaded · quantization" on a local row. */
  localDetail: (model: T) => string
  /** Shown in place of the local group when the host has nothing to offer. */
  emptyLocal?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [storedSource, setSource] = useModelSource()
  const localCount = models.filter((m) => m.local).length
  // The filter only exists while there is a local host to filter by.
  const hasLocal = localCount > 0 || emptyLocal !== null
  const source = hasLocal ? storedSource : "all"
  const { allowed, blocked } = partitionByPolicy(bySource(models, source), zdr)
  const providers = groupByProvider(allowed)
  const selected = models.find((m) => m.id === value)
  const showEmptyLocal = localCount === 0 && source !== "external"

  function changeOpen(next: boolean) {
    setOpen(next)
    onOpenChange?.(next)
  }

  function renderRow(m: T, isBlocked: boolean) {
    return (
      <CommandItem
        key={m.id}
        // The group name is part of the value, so typing "local" or the host
        // finds local models as well as typing their names.
        value={`${m.name} ${m.provider}${m.local ? " local" : ""}`}
        data-checked={!isBlocked && m.id === value}
        disabled={isBlocked}
        onSelect={
          isBlocked
            ? undefined
            : () => {
                onValueChange(m.id)
                changeOpen(false)
              }
        }
      >
        {m.local ? (
          <LocalRow
            name={m.name}
            local={m.local}
            detail={localDetail(m)}
            checked={m.id === value}
          />
        ) : (
          <>
            <span className="flex-1 truncate">{m.name}</span>
            <span className={cn(m.id === value && "mr-1.5")}>{detail(m)}</span>
          </>
        )}
      </CommandItem>
    )
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
      <PopoverContent
        className="max-h-(--available-height) w-(--anchor-width) overflow-hidden p-0"
        sideOffset={4}
      >
        <Command className="min-h-0">
          {hasLocal ? (
            <Tabs
              value={source}
              onValueChange={(next) => setSource(next as ModelSource)}
              className="p-1.5 pb-0"
            >
              <TabsList className="h-8 w-full">
                <TabsTrigger value="all" className="flex-1 text-xs">
                  All
                </TabsTrigger>
                <TabsTrigger value="local" className="flex-1 text-xs">
                  Local
                </TabsTrigger>
                <TabsTrigger value="external" className="flex-1 text-xs">
                  External
                </TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="min-h-0">
            {source === "local" && showEmptyLocal && emptyLocal ? null : (
              <CommandEmpty>No model found.</CommandEmpty>
            )}
            {showEmptyLocal && emptyLocal ? emptyLocal : null}
            {providers.map(({ provider, models: providerModels }) => (
              <CommandGroup key={provider} heading={provider}>
                {providerModels.map((m) => renderRow(m, false))}
              </CommandGroup>
            ))}
            {blocked.length > 0 ? (
              <CommandGroup heading="No zero-retention provider">
                {blocked.map((m) => renderRow(m, true))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * A local model's row: whether it is already in memory decides whether the
 * first passage waits for a load and a full read of the prompt.
 */
function LocalRow({
  name,
  local,
  detail,
  checked,
}: {
  name: string
  local: LocalModelInfo
  detail: string
  checked: boolean
}) {
  return (
    <span className={cn("flex min-w-0 flex-1 flex-col", checked && "mr-1.5")}>
      <span className="truncate">{name}</span>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            local.loaded ? "bg-emerald-500" : "bg-muted-foreground/40"
          )}
        />
        {[local.loaded ? "loaded" : "cold", local.quantization, detail || null]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </span>
  )
}
