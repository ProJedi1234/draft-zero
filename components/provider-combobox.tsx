"use client"

import { useState } from "react"
import { ChevronsUpDownIcon, SparklesIcon, ZapIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  formatContextLength,
  formatThroughput,
  formatUptime,
} from "@/lib/format"
import {
  partitionByZdr,
  routableEndpointForTag,
  type ModelEndpoint,
} from "@/lib/types"
import { cn } from "@/lib/utils"

/** The Auto row's value inside cmdk, which has no concept of a null value. */
const AUTO_VALUE = "__auto__"

/**
 * A provider's mark: its initial in a small squared tile.
 *
 * Deliberately not a brand logo. Sixty-odd upstream providers ship no icon in
 * the endpoints API, so a real logo set would mean sixty hand-traced SVGs that
 * rot as providers rebrand — and half of them would be missing on the day a new
 * one appears. An initial in a tile is always available, always the same size,
 * and reads as an icon at 14px, which is all this row needs it to do.
 */
function ProviderGlyph({
  providerName,
  className,
}: {
  providerName: string
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center bg-muted text-[9px] font-semibold text-muted-foreground uppercase",
        className
      )}
    >
      {providerName.slice(0, 1)}
    </span>
  )
}

/**
 * Which upstream endpoint serves the selected model. `null` is Auto — OpenRouter
 * routes by its own ranking, which is the right answer until a writer has a
 * reason it isn't.
 *
 * Rows carry the numbers that make the choice: median output speed over the last
 * half hour (the reason most writers pin a provider at all), price, window and
 * quantization, since two providers serving identical weights routinely differ
 * in all four. Renders nothing while the endpoint list is still loading or when
 * the catalog has no endpoints for this model — an empty menu is worse than no
 * menu.
 *
 * Under a zero-data-retention policy the menu splits: the endpoints that keep
 * nothing are the ones on offer, and the rest stay visible at the bottom,
 * greyed and unselectable. Dropping them silently would leave the writer
 * wondering where their provider went, and a menu that answers that question is
 * worth the six rows it costs.
 */
export function ProviderCombobox({
  id,
  endpoints,
  value,
  onValueChange,
  zdr,
  onOpenChange,
  disabled,
}: {
  id?: string
  /** Endpoints for the selected model, fastest first. */
  endpoints: ModelEndpoint[]
  /** Pinned endpoint tag, or null for Auto. */
  value: string | null
  onValueChange: (providerTag: string | null) => void
  /** Effective retention policy: on, only the endpoints that keep nothing are pickable. */
  zdr: boolean
  /** Reported so a caller can hold off server-driven changes while this is open. */
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  if (endpoints.length === 0) return null

  const { allowed, blocked } = partitionByZdr(endpoints, zdr)
  // The pin as the request will actually honour it. A tag naming an endpoint the
  // policy rules out is dropped on the way out (providerParam), so showing it
  // here would name a provider that is not going to serve the request.
  const selected = routableEndpointForTag(endpoints, value, zdr)
  // The fastest endpoint stands in for Auto's speed. Not a promise — OpenRouter
  // weighs price and uptime too — so the row says "up to". Taken as a max rather
  // than the head of the list, which is sorted by speed but need not be.
  const fastest = allowed.reduce<number | null>(
    (best, e) =>
      e.throughput !== null && (best === null || e.throughput > best)
        ? e.throughput
        : best,
    null
  )

  function changeOpen(next: boolean) {
    setOpen(next)
    onOpenChange?.(next)
  }

  function select(tag: string | null) {
    onValueChange(tag)
    changeOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            size="sm"
            disabled={disabled}
            className="w-full justify-between font-normal normal-case"
          />
        }
      >
        <span className="text-muted-foreground">Provider</span>
        <span className="flex min-w-0 items-center gap-1.5">
          {selected ? (
            <ProviderGlyph providerName={selected.providerName} />
          ) : (
            <SparklesIcon className="size-3.5 shrink-0 opacity-60" />
          )}
          <span className="truncate">{selected?.providerName ?? "Auto"}</span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-50" />
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) p-0" sideOffset={4}>
        <Command>
          <CommandList>
            <CommandGroup>
              <CommandItem
                value={AUTO_VALUE}
                data-checked={value === null}
                disabled={allowed.length === 0}
                onSelect={() => select(null)}
              >
                <SparklesIcon className="opacity-60" />
                <span className="flex-1 truncate">Auto</span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {allowed.length === 0
                    ? "none available"
                    : fastest === null
                      ? `${allowed.length} providers`
                      : `up to ${formatThroughput(fastest)}`}
                </span>
              </CommandItem>
            </CommandGroup>
            {allowed.length > 0 ? (
              <CommandGroup heading="Providers">
                {allowed.map((endpoint) => (
                  <EndpointRow
                    key={endpoint.tag}
                    endpoint={endpoint}
                    checked={endpoint.tag === value}
                    onSelect={() => select(endpoint.tag)}
                  />
                ))}
              </CommandGroup>
            ) : (
              // Not an empty menu but an explained one: under this policy the
              // MODEL is the problem, and the fix is one control up.
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No provider serving this model keeps nothing. Pick another
                model, or turn off zero data retention.
              </p>
            )}
            {blocked.length > 0 ? (
              <CommandGroup heading="Retains prompts">
                {blocked.map((endpoint) => (
                  <EndpointRow
                    key={endpoint.tag}
                    endpoint={endpoint}
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
 * One provider row. `blocked` is a row the current data policy rules out: it is
 * printed with the same numbers as any other, greyed and unselectable, so the
 * writer can see the provider they were looking for and what it would cost them
 * to have it back.
 */
function EndpointRow({
  endpoint,
  checked,
  blocked = false,
  onSelect,
}: {
  endpoint: ModelEndpoint
  checked: boolean
  blocked?: boolean
  onSelect?: () => void
}) {
  return (
    <CommandItem
      value={`${endpoint.providerName} ${endpoint.tag}`}
      data-checked={checked}
      disabled={blocked}
      onSelect={onSelect}
      className="items-start"
    >
      <ProviderGlyph providerName={endpoint.providerName} className="mt-0.5" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate">{endpoint.providerName}</span>
          {endpoint.quantization ? (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {endpoint.quantization}
            </span>
          ) : null}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
          {endpoint.pricing.prompt}/{endpoint.pricing.completion} ·{" "}
          {formatContextLength(endpoint.contextLength)}
          {/* Uptime appears only when it is a reason not to pick this row. A
              provider that has been up all day says nothing worth a third of
              the line. */}
          {endpoint.uptime !== null && endpoint.uptime < 0.99
            ? ` · ${formatUptime(endpoint.uptime)} up`
            : null}
        </span>
      </span>
      <span
        className={cn(
          "flex shrink-0 items-center gap-1 font-mono text-xs text-muted-foreground tabular-nums",
          checked && "mr-1.5"
        )}
      >
        <ZapIcon className="size-3 opacity-60" />
        {formatThroughput(endpoint.throughput)}
      </span>
    </CommandItem>
  )
}
