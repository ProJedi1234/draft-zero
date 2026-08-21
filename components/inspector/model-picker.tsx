"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronsUpDownIcon, Loader2, ShieldCheck, Star } from "lucide-react"

import { ModelCombobox } from "@/components/model-combobox"
import { ProviderCombobox } from "@/components/provider-combobox"
import { ThinkingSelect } from "@/components/thinking-select"
import { ZdrSwitch, type ZdrLock } from "@/components/zdr-switch"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { formatContextLength } from "@/lib/format"
import { settingsSummary } from "@/lib/settings-summary"
import {
  routableEndpointForTag,
  type ModelEndpoint,
  type ModelProfile,
  type OpenRouterModel,
  type ThinkingLevel,
} from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Provider-grouped model select. Controlled by the inspector so the context
 * meter can size itself against the model the writer just picked; persistence
 * happens in `onValueChange` (immediate, never debounced — §4.4).
 *
 * Underneath sit the settings that only mean anything one model deep: which
 * upstream endpoint serves it, how hard it thinks, and whether the endpoints it
 * may be served by have to keep nothing. The footnote reports the price and
 * window of whatever will actually serve the request — the pinned endpoint's
 * numbers when there is one, the model's own under Auto, because on a
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
  zdr,
  onZdrChange,
  zdrLock = null,
  accountEnforced = false,
  onOpenChange,
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
  /**
   * This bundle's own effective policy, app-wide floor included. It governs the
   * MODEL list, because it applies to every model equally.
   */
  zdr: boolean
  onZdrChange: (zdr: boolean) => void
  /** Why the writer cannot turn it off here, if they cannot. */
  zdrLock?: ZdrLock
  /**
   * The OpenRouter account forces retention-free routing on the SELECTED
   * model's group. It governs the provider list and the price, and deliberately
   * not the model list: enforcement is per group, so a locked Anthropic says
   * nothing about which Google models are pickable.
   */
  accountEnforced?: boolean
  /**
   * True while any of the three is open. These settings depend on each other —
   * the model decides which thinking levels and which endpoints exist — so a
   * server-driven model change can retarget or unmount a menu the writer is
   * reading. The inspector holds all three still until this goes false.
   */
  onOpenChange?: (open: boolean) => void
}) {
  const selected = models.find((m) => m.id === value)
  const [open, setOpen] = React.useState({
    model: false,
    provider: false,
    thinking: false,
  })

  function report(key: keyof typeof open, next: boolean) {
    setOpen((o) => (o[key] === next ? o : { ...o, [key]: next }))
  }

  // Both sub-controls render nothing when they would have nothing to offer, and
  // a menu that disappears mid-interaction cannot report itself closed — so the
  // flags are qualified here rather than trusted, or one disappearing menu
  // would hold the inspector shut for good.
  const anyOpen =
    open.model ||
    (endpoints.length > 0 && open.provider) ||
    (selected?.reasoning != null && open.thinking)
  React.useEffect(() => {
    onOpenChange?.(anyOpen)
  }, [anyOpen, onOpenChange])
  // Unmounting counts as closing. Custom mode can be switched off from another
  // device, taking these controls with it, and a hold left standing would stop
  // the whole inspector from following the server for the life of the mount.
  React.useEffect(() => () => onOpenChange?.(false), [onOpenChange])

  // What this model will actually be routed under: the bundle's policy, or the
  // account's for this model's group, whichever is set. The account's is not in
  // `zdr` because it is not the writer's setting and does not travel with the
  // bundle to another model.
  const providerZdr = zdr || accountEnforced
  // Routable, not merely pinned: under a retention policy a pin naming an
  // endpoint that retains is dropped on the way out, and pricing the request
  // against it would quote a provider that is not going to serve it.
  const endpoint = routableEndpointForTag(endpoints, providerTag, providerZdr)
  const pricing = endpoint?.pricing ?? selected?.pricing
  const contextLength = endpoint?.contextLength ?? selected?.contextLength

  return (
    <div className="space-y-2">
      <Label>Model</Label>
      <ModelCombobox
        models={models}
        value={value}
        onValueChange={onValueChange}
        zdr={zdr}
        onOpenChange={(next) => report("model", next)}
      />
      <ProviderCombobox
        endpoints={endpoints}
        value={providerTag}
        onValueChange={onProviderTagChange}
        zdr={providerZdr}
        onOpenChange={(next) => report("provider", next)}
      />
      <ThinkingSelect
        reasoning={selected?.reasoning ?? null}
        value={thinking}
        onValueChange={onThinkingChange}
        onOpenChange={(next) => report("thinking", next)}
      />
      <PricingLine pricing={pricing} contextLength={contextLength} />
      <div className="pt-1">
        <ZdrSwitch
          checked={zdr}
          onCheckedChange={onZdrChange}
          lock={zdrLock}
          hint="Only providers that keep nothing."
        />
      </div>
    </div>
  )
}

/**
 * Price and window of whatever will actually serve the request. Rendered by the
 * raw picker and by the profile card, which must not disagree about the numbers.
 */
function PricingLine({
  pricing,
  contextLength,
  className,
}: {
  pricing: OpenRouterModel["pricing"] | undefined
  contextLength: number | undefined
  className?: string
}) {
  if (!pricing || contextLength === undefined) return null
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      In {pricing.prompt} · Out {pricing.completion} per 1M ·{" "}
      {formatContextLength(contextLength)} context
    </p>
  )
}

/**
 * The whole model section, when a story follows a profile: name, the bundle in
 * one line, and what it costs. The three pickers above are hidden in that mode —
 * a followed profile has no per-story knobs by construction, which is what keeps
 * it from silently drifting — so this card is also the only way back out, via
 * the menu it opens.
 *
 * In Custom mode it shrinks to a header for the controls below it.
 */
export function ProfileCard({
  profiles,
  profileId,
  defaultProfileId,
  onProfileChange,
  switching = false,
  models,
  endpoints,
  zdr,
  basedOnName,
  onOpenChange,
}: {
  profiles: ModelProfile[]
  /** The followed profile, or null for Custom. */
  profileId: string | null
  defaultProfileId: string | null
  onProfileChange: (profileId: string | null) => void
  /**
   * True while this card is ahead of the server. The card itself moves on the
   * click, but everything derived from the story's resolved settings — the
   * context meter above all — is still the previous profile's until the tree
   * comes back, and a stale token count that looks live is worse than a slow
   * one that says so.
   */
  switching?: boolean
  models: OpenRouterModel[]
  /** Endpoints serving the effective model, for the pinned endpoint's price. */
  endpoints: ModelEndpoint[]
  /**
   * The effective retention policy. Shown here because a followed profile hides
   * every control below this card, and this mark is then the only place a
   * writer can see what their story's data policy actually is.
   */
  zdr: boolean
  /** Profile this session left for Custom, if any; drives the "based on" line. */
  basedOnName?: string | null
  /** Reported so the caller can hold server-driven changes while the menu is open. */
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = React.useState(false)
  // A profile id with no row — deleted on another device between the page load
  // and this render — reads as Custom, which is what the server resolves it to.
  const followed = profiles.find((profile) => profile.id === profileId) ?? null

  const model = followed
    ? models.find((m) => m.id === followed.settings.modelId)
    : undefined
  const endpoint = followed
    ? routableEndpointForTag(endpoints, followed.settings.providerTag, zdr)
    : undefined

  function changeOpen(next: boolean) {
    setOpen(next)
    onOpenChange?.(next)
  }

  return (
    <div className="space-y-2">
      <Label className="gap-1.5">
        Profile
        {/* Polite, and the text is for screen readers only: the spinner is the
            whole message sighted, and a label that grows a word would shift the
            card under the pointer that just clicked it. */}
        <span aria-live="polite" className="flex items-center">
          {switching ? (
            <>
              <Loader2
                aria-hidden
                className="size-3 animate-spin text-muted-foreground"
              />
              <span className="sr-only">Switching profile…</span>
            </>
          ) : null}
        </span>
      </Label>
      <DropdownMenu open={open} onOpenChange={changeOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              aria-label="Model profile"
              className="h-auto w-full justify-between gap-2 py-2 font-normal normal-case"
            />
          }
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left tracking-normal">
            <span className="flex min-w-0 items-center gap-1.5">
              {followed && followed.id === defaultProfileId ? (
                <Star aria-hidden className="size-3.5 shrink-0 fill-current" />
              ) : null}
              <span className="truncate text-sm font-medium">
                {followed ? followed.name : "Custom"}
              </span>
              {zdr ? (
                <>
                  <ShieldCheck
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="sr-only">Zero data retention</span>
                </>
              ) : null}
              {followed ? null : (
                <Badge variant="secondary" className="shrink-0">
                  this story
                </Badge>
              )}
            </span>
            {followed ? (
              <>
                <span className="truncate text-xs text-muted-foreground">
                  {settingsSummary(followed.settings, models)}
                </span>
                <PricingLine
                  className="truncate"
                  pricing={endpoint?.pricing ?? model?.pricing}
                  contextLength={
                    endpoint?.contextLength ?? model?.contextLength
                  }
                />
              </>
            ) : basedOnName ? (
              <span className="truncate text-xs text-muted-foreground">
                based on {basedOnName}
              </span>
            ) : null}
          </span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-80">
          {profiles.map((profile) => (
            <DropdownMenuItem
              key={profile.id}
              className="items-start normal-case"
              onClick={() => onProfileChange(profile.id)}
            >
              {/* Always rendered, invisible when not the default: the names
                  have to line up down the column. */}
              <Star
                aria-hidden
                className={cn(
                  "mt-0.5 shrink-0",
                  profile.id === defaultProfileId ? "fill-current" : "invisible"
                )}
              />
              <MenuRowText
                name={profile.name}
                detail={settingsSummary(profile.settings, models)}
              />
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="items-start normal-case"
            onClick={() => onProfileChange(null)}
          >
            <span aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <MenuRowText
              name="Custom…"
              detail="edit settings for this story only"
            />
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-muted-foreground"
            render={<Link href="/settings" />}
          >
            Manage profiles…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function MenuRowText({ name, detail }: { name: string; detail: string }) {
  return (
    <span className="flex min-w-0 flex-col tracking-normal">
      <span className="truncate text-sm font-medium">{name}</span>
      <span className="truncate text-xs text-muted-foreground">{detail}</span>
    </span>
  )
}
