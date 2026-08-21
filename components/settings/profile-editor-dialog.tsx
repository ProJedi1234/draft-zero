"use client"

import * as React from "react"
import { ChevronsUpDown, Loader2, Star } from "lucide-react"
import { toast } from "sonner"

import { ContextWindowSlider } from "@/components/inspector/context-window-slider"
import { ModelPicker } from "@/components/inspector/model-picker"
import { SliderField } from "@/components/slider-field"
import { levelForModel } from "@/components/thinking-select"
import type { ZdrLock } from "@/components/zdr-switch"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAccountZdrForModel } from "@/hooks/use-account-zdr"
import { useModelEndpoints } from "@/hooks/use-model-endpoints"
import {
  createProfile,
  setDefaultProfile,
  updateProfile,
} from "@/lib/actions/profiles"
import {
  clampContextWindow,
  routableEndpointForTag,
  LORE_BUDGET_MAX,
  LORE_BUDGET_MIN,
  LORE_BUDGET_STEP,
  type GenerationDefaults,
  type GenerationOverrides,
  type ModelProfile,
  type OpenRouterModel,
  type ProfileSettings,
} from "@/lib/types"

const FALLBACK_ERROR = "Couldn't save the profile."

/**
 * What the dialog is doing to the profile it was handed. "duplicate" is a
 * create that starts from an existing profile's settings, so it is a mode
 * rather than a third dialog.
 */
export type ProfileEditorMode = "create" | "edit" | "duplicate"

export interface ProfileEditorTarget {
  mode: ProfileEditorMode
  /**
   * The profile the draft starts from — the row being updated under "edit",
   * and merely a seed under "create" and "duplicate", where a new row is
   * inserted. Null only when there is no profile to seed from at all.
   */
  profile: ModelProfile | null
}

const TITLES: Record<ProfileEditorMode, string> = {
  create: "New profile",
  edit: "Edit profile",
  duplicate: "Duplicate profile",
}

/**
 * Create, edit and duplicate a profile, in the inspector's own controls plus a
 * name — a writer who has set a model in a story should recognise every knob.
 *
 * A draft, not a live surface: nothing is written until save, so the controls
 * hold plain state rather than following the server (hooks/use-server-synced.ts
 * exists for controls that mirror a row while it can change underneath them).
 * Editing a profile moves every story following it, which is why the footer
 * says how many that is before the writer commits.
 */
export function ProfileEditorDialog({
  target,
  open,
  onOpenChange,
  models,
  defaults,
  requireZdr,
  isDefault,
  followerCount,
}: {
  target: ProfileEditorTarget
  open: boolean
  onOpenChange: (open: boolean) => void
  models: OpenRouterModel[]
  /** The global slider values an inheriting field shows and generates under. */
  defaults: GenerationDefaults
  /** The app-wide retention policy; a profile can add to it, never lower it. */
  requireZdr: boolean
  /** True when the profile being edited is already the one new stories start from. */
  isDefault: boolean
  /** Stories following the profile being edited; 0 for a create. */
  followerCount: number
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent sheet className="sm:max-w-md">
        {/* Keyed by what is being edited: the draft seeds from the profile once
            and must not be reseeded when a sync refresh re-renders the page. */}
        <ProfileEditorForm
          key={`${target.mode}:${target.profile?.id ?? "new"}`}
          target={target}
          models={models}
          defaults={defaults}
          requireZdr={requireZdr}
          isDefault={isDefault}
          followerCount={followerCount}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

/**
 * Only reachable with an empty profile table, which getAppSettings' lazy seed
 * makes a momentary state at most. Every slider inherits: a brand-new profile
 * has no opinion of its own until the writer gives it one, and there is no
 * second copy of the app defaults here to drift from the real ones.
 */
function blankSettings(models: OpenRouterModel[]): ProfileSettings {
  return {
    modelId: models[0]?.id ?? "",
    thinking: "off",
    providerTag: null,
    zdr: false,
    temperature: null,
    topP: null,
    maxTokens: null,
    contextWindow: null,
    loreBudget: null,
    frequencyPenalty: null,
    presencePenalty: null,
  }
}

function initialDraft(
  target: ProfileEditorTarget,
  models: OpenRouterModel[]
): { name: string; settings: ProfileSettings } {
  if (!target.profile) return { name: "", settings: blankSettings(models) }
  const name =
    target.mode === "create"
      ? ""
      : target.mode === "duplicate"
        ? `${target.profile.name} copy`
        : target.profile.name
  return { name, settings: { ...target.profile.settings } }
}

function ProfileEditorForm({
  target,
  models,
  defaults,
  requireZdr,
  isDefault,
  followerCount,
  onDone,
}: {
  target: ProfileEditorTarget
  models: OpenRouterModel[]
  defaults: GenerationDefaults
  requireZdr: boolean
  isDefault: boolean
  followerCount: number
  onDone: () => void
}) {
  const [initial] = React.useState(() => initialDraft(target, models))
  const [name, setName] = React.useState(initial.name)
  const [settings, setSettings] = React.useState(initial.settings)
  const [makeDefault, setMakeDefault] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const { endpoints } = useModelEndpoints(settings.modelId)
  const accountZdr = useAccountZdrForModel(settings.modelId)
  // The floor, wherever it comes from. A profile under one still stores its own
  // false — lowering the floor later has to give the profile back what it says.
  const zdrLock: ZdrLock =
    accountZdr === "enforced" ? "account" : requireZdr ? "app" : null

  const model = models.find((m) => m.id === settings.modelId)
  // A pinned endpoint wins over the model's own window, same as the inspector:
  // a third-party host frequently serves less than the lab does.
  // The bundle's own policy — what the model list filters against and what the
  // switch stores. The account's per-group enforcement rides alongside rather
  // than inside it: it belongs to the selected model, not to the profile.
  const zdr = settings.zdr || requireZdr
  const accountEnforced = accountZdr === "enforced"
  const contextLength =
    routableEndpointForTag(
      endpoints,
      settings.providerTag,
      zdr || accountEnforced
    )?.contextLength ??
    model?.contextLength ??
    0
  // Clamped for display, and saved that way — the ladder stop the writer can
  // see is the one the profile should hold. An inherited window shows the
  // global default through the same clamp: the model's ceiling applies to the
  // value that will actually be sent, whoever it came from.
  const contextWindow = clampContextWindow(
    settings.contextWindow ?? defaults.contextWindow,
    contextLength
  )

  function patch(next: Partial<ProfileSettings>) {
    setSettings((current) => ({ ...current, ...next }))
  }

  /**
   * The props that make one slider an inherit/override pair: what to show, and
   * the way back. Dragging promotes through the field's own onValueChange —
   * every one of them writes a number, which is exactly what an override is.
   */
  function inherit<K extends keyof GenerationOverrides>(field: K) {
    return {
      value: settings[field] ?? defaults[field],
      inherited: settings[field] === null,
      onRevert:
        settings[field] === null
          ? undefined
          : () => patch({ [field]: null } as Partial<ProfileSettings>),
    }
  }

  function handleModelChange(nextModelId: string) {
    if (nextModelId === settings.modelId) return
    const nextModel = models.find((m) => m.id === nextModelId)
    // The inspector's coupling rules, on a draft instead of a row: a provider
    // tag names an endpoint of the old model, a thinking level the new model
    // doesn't offer would be rejected on send, and a window it can't hold has
    // to come down with it.
    patch({
      modelId: nextModelId,
      providerTag: null,
      thinking: levelForModel(nextModel?.reasoning, settings.thinking),
      // An inherited window stays inherited across a model switch: the clamp is
      // applied to whatever it resolves to at send time, and promoting the
      // field here would be the model picker silently taking an opinion.
      contextWindow:
        settings.contextWindow === null
          ? null
          : clampContextWindow(
              settings.contextWindow,
              nextModel?.contextLength ?? 0
            ),
    })
  }

  function handleProviderChange(nextProviderTag: string | null) {
    if (nextProviderTag === settings.providerTag) return
    patch({
      providerTag: nextProviderTag,
      contextWindow:
        settings.contextWindow === null
          ? null
          : clampContextWindow(
              settings.contextWindow,
              routableEndpointForTag(
                endpoints,
                nextProviderTag,
                zdr || accountEnforced
              )?.contextLength ??
                model?.contextLength ??
                0
            ),
    })
  }

  const trimmed = name.trim()

  function handleSave() {
    if (trimmed === "" || isPending) return
    startTransition(async () => {
      // The clamp reaches the row only on an overridden window; an inherited
      // one saves as the null it is.
      const saved: ProfileSettings = {
        ...settings,
        contextWindow: settings.contextWindow === null ? null : contextWindow,
      }
      const editing = target.mode === "edit" ? target.profile : null
      try {
        let id: string
        if (editing) {
          const result = await updateProfile(editing.id, {
            name: trimmed,
            settings: saved,
          })
          if (!result.ok) {
            toast.error(result.error)
            return
          }
          id = editing.id
        } else {
          const result = await createProfile({ name: trimmed, settings: saved })
          if (!result.ok) {
            toast.error(result.error)
            return
          }
          id = result.data.id
        }
        // A second call rather than a flag on the first: setDefaultProfile is
        // the only writer of the default, and a create has no id to point at
        // until it returns one.
        if (makeDefault && !isDefault) {
          const promoted = await setDefaultProfile(id)
          if (!promoted.ok) toast.error(promoted.error)
        }
        toast.success(editing ? "Profile saved" : "Profile created")
        onDone()
      } catch (error) {
        // A thrown action — a dropped connection mid-save — never reaches the
        // `ok` check above.
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : FALLBACK_ERROR
        )
      }
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{TITLES[target.mode]}</DialogTitle>
        <DialogDescription>
          A named bundle of model, provider, thinking and sampling. Stories
          following it track every change.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="sm:max-h-[60svh]">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Quality"
              disabled={isPending}
            />
          </div>

          <ModelPicker
            models={models}
            value={settings.modelId}
            onValueChange={handleModelChange}
            endpoints={endpoints}
            providerTag={settings.providerTag}
            onProviderTagChange={handleProviderChange}
            thinking={settings.thinking}
            onThinkingChange={(thinking) => patch({ thinking })}
            zdr={zdr}
            onZdrChange={(next) => patch({ zdr: next })}
            zdrLock={zdrLock}
            accountEnforced={accountEnforced}
          />

          <Collapsible>
            <CollapsibleTrigger
              render={
                <Button
                  variant="ghost"
                  size="xs"
                  className="w-full justify-between text-muted-foreground"
                />
              }
            >
              Generation settings
              <ChevronsUpDown className="size-3" />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-6 pt-4">
              <p className="text-xs text-muted-foreground">
                Dimmed fields follow the Generation defaults. Drag one to give
                this profile its own value.
              </p>
              <SliderField
                label="Temperature"
                {...inherit("temperature")}
                min={0}
                max={2}
                step={0.01}
                onValueChange={(temperature) => patch({ temperature })}
              />
              <SliderField
                label="Top P"
                {...inherit("topP")}
                min={0}
                max={1}
                step={0.01}
                onValueChange={(topP) => patch({ topP })}
              />
              <SliderField
                label="Max tokens"
                {...inherit("maxTokens")}
                min={128}
                max={4096}
                step={128}
                onValueChange={(maxTokens) => patch({ maxTokens })}
              />
              <ContextWindowSlider
                value={contextWindow}
                contextLength={contextLength}
                inherited={settings.contextWindow === null}
                onRevert={
                  settings.contextWindow === null
                    ? undefined
                    : () => patch({ contextWindow: null })
                }
                onValueChange={(next) => patch({ contextWindow: next })}
                onValueCommitted={(next) => patch({ contextWindow: next })}
              />
              <SliderField
                label="Lore budget"
                {...inherit("loreBudget")}
                min={LORE_BUDGET_MIN}
                max={LORE_BUDGET_MAX}
                step={LORE_BUDGET_STEP}
                formatReadout={(value) => `${value}%`}
                onValueChange={(loreBudget) => patch({ loreBudget })}
              />
              <SliderField
                label="Frequency penalty"
                {...inherit("frequencyPenalty")}
                min={-2}
                max={2}
                step={0.1}
                onValueChange={(frequencyPenalty) =>
                  patch({ frequencyPenalty })
                }
              />
              <SliderField
                label="Presence penalty"
                {...inherit("presencePenalty")}
                min={-2}
                max={2}
                step={0.1}
                onValueChange={(presencePenalty) => patch({ presencePenalty })}
              />
            </CollapsibleContent>
          </Collapsible>
        </div>
      </DialogBody>

      {target.mode === "edit" && followerCount > 0 ? (
        <p className="shrink-0 text-xs text-muted-foreground">
          Followed by {followerCount}{" "}
          {followerCount === 1 ? "story" : "stories"} — they&apos;ll update on
          save.
        </p>
      ) : null}

      <DialogFooter className="sm:justify-between">
        {isDefault ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Star className="size-3.5 fill-current" />
            New stories start from this profile.
          </span>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={makeDefault}
            disabled={isPending}
            onClick={() => setMakeDefault((current) => !current)}
          >
            <Star
              data-icon="inline-start"
              className={makeDefault ? "fill-current" : undefined}
            />
            Make default
          </Button>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <DialogClose
            render={<Button type="button" variant="outline" size="sm" />}
          >
            Cancel
          </DialogClose>
          <Button
            type="button"
            size="sm"
            disabled={trimmed === "" || isPending}
            onClick={handleSave}
          >
            {isPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : null}
            Save
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
