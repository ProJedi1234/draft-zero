"use client"

import * as React from "react"
import { ChevronsUpDown } from "lucide-react"
import { toast } from "sonner"

import { ContextDialog } from "@/components/context/context-dialog"
import { ContextWindowSlider } from "@/components/inspector/context-window-slider"
import { LoreTab } from "@/components/inspector/lore-tab"
import { ModelPicker, ProfileCard } from "@/components/inspector/model-picker"
import { SaveProfileDialog } from "@/components/inspector/save-profile-dialog"
import { SettingSlider } from "@/components/inspector/setting-slider"
import { levelForModel } from "@/components/thinking-select"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Meter } from "@/components/ui/meter"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { useAutosave } from "@/hooks/use-autosave"
import { useDragHold } from "@/hooks/use-drag-hold"
import { useModelEndpoints } from "@/hooks/use-model-endpoints"
import {
  useServerSyncedField,
  useServerSyncedValue,
} from "@/hooks/use-server-synced"
import { setStoryProfile } from "@/lib/actions/profiles"
import {
  updateGenerationSettings,
  updateStoryMeta,
} from "@/lib/actions/stories"
import { describeContext } from "@/lib/generation/breakdown"
import { composeContext } from "@/lib/generation/context"
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/generation/system-prompt"
import {
  clampContextWindow,
  contextWindowLabel,
  endpointForTag,
  type GenerationSettings,
  type LorebookEntry,
  type ModelProfile,
  type OpenRouterModel,
  type Story,
  type ThinkingLevel,
} from "@/lib/types"
import { cn } from "@/lib/utils"

const FALLBACK_ERROR = "Couldn't save your changes."

export function InspectorPanel({
  story,
  lorebookEntries,
  models,
  profiles,
  defaultProfileId,
  className,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
  models: OpenRouterModel[]
  /** Every profile, in the writer's order — the switcher's list. */
  profiles: ModelProfile[]
  /** The profile new stories start from; starred in the switcher. */
  defaultProfileId: string | null
  className?: string
}) {
  return (
    <aside
      aria-label="Inspector"
      className={cn(
        "w-80 shrink-0 flex-col overflow-hidden border-l bg-background",
        className
      )}
    >
      <InspectorContent
        story={story}
        lorebookEntries={lorebookEntries}
        models={models}
        profiles={profiles}
        defaultProfileId={defaultProfileId}
      />
    </aside>
  )
}

/**
 * Inspector sections without the aside chrome — shared by the desktop panel and
 * the mobile sheet. The `key` remounts everything when the writer switches
 * stories, which is what clears any edit-in-flight bookkeeping the old story's
 * controls were holding; while mounted, every control follows the server on its
 * own (see hooks/use-server-synced.ts).
 */
export function InspectorContent({
  story,
  lorebookEntries,
  models,
  profiles,
  defaultProfileId,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
  models: OpenRouterModel[]
  profiles: ModelProfile[]
  defaultProfileId: string | null
}) {
  return (
    <InspectorSections
      key={story.id}
      story={story}
      lorebookEntries={lorebookEntries}
      models={models}
      profiles={profiles}
      defaultProfileId={defaultProfileId}
    />
  )
}

function InspectorSections({
  story,
  lorebookEntries,
  models,
  profiles,
  defaultProfileId,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
  models: OpenRouterModel[]
  profiles: ModelProfile[]
  defaultProfileId: string | null
}) {
  // Unique per mounted instance: the desktop panel and the mobile sheet can be
  // in the DOM at once, and duplicate ids would cross-wire the labels.
  const uid = React.useId()
  // These depend on each other, so any open menu holds all of them: adopting a
  // foreign model while the writer is reading one of them would retarget the
  // endpoint list under the cursor, or unmount the thinking menu outright — and
  // a profile arriving mid-menu would swap the whole section out from under it.
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = React.useState(false)
  const menuOpen = pickerOpen || profileMenuOpen
  // Which mode the story is in. Following a profile, the settings below are the
  // profile's and nothing here may write them; Custom, they are the story's own.
  const profile = useServerSyncedValue(story.profileId, { hold: menuOpen })
  const profileId = profile.value
  const followedProfile =
    profiles.find((candidate) => candidate.id === profileId) ?? null
  const isCustom = followedProfile === null
  // The profile this session left for Custom — enough for a "based on" line and
  // a one-tap way back, and deliberately not persisted: which profile a custom
  // story once came from is not a fact the story owes anyone across devices.
  const [lastProfileId, setLastProfileId] = React.useState<string | null>(null)
  const basedOnProfile =
    profiles.find((candidate) => candidate.id === lastProfileId) ?? null
  const [saveProfileOpen, setSaveProfileOpen] = React.useState(false)
  // The four settings that move together. Each follows the server while mounted
  // — a model switched on the phone lands here — but never while this device's
  // own write is still travelling; see hooks/use-server-synced.ts.
  const model = useServerSyncedValue(story.settings.modelId, {
    hold: menuOpen,
  })
  const thinkingSync = useServerSyncedValue(story.settings.thinking, {
    hold: menuOpen,
  })
  const provider = useServerSyncedValue(story.settings.providerTag, {
    hold: menuOpen,
  })
  const modelId = model.value
  const thinking = thinkingSync.value
  const providerTag = provider.value
  const { endpoints } = useModelEndpoints(modelId)
  // The ceiling in force for the duration of a drag; see windowDragProps below.
  const [heldContextLength, setHeldContextLength] = React.useState<
    number | null
  >(null)
  const { dragging: draggingWindow, dragProps: startWindowDrag } = useDragHold(
    () => setHeldContextLength(null)
  )
  // Lifted out of the slider because the model owns its ceiling: switching
  // models has to be able to pull the value down (see handleModelChange).
  const {
    value: storedContextWindow,
    server: savedContextWindow,
    setLocal: setContextWindowLocal,
    write: writeContextWindow,
    settle: settleContextWindow,
    reset: resetContextWindow,
  } = useServerSyncedValue(story.settings.contextWindow, {
    hold: draggingWindow,
  })
  const [titleEmpty, setTitleEmpty] = React.useState(false)
  const [, startTransition] = React.useTransition()

  const titleSave = useAutosave((value: string) =>
    updateStoryMeta(story.id, { title: value })
  )
  const descriptionSave = useAutosave((value: string) =>
    updateStoryMeta(story.id, { description: value })
  )
  const genreSave = useAutosave((value: string) =>
    updateStoryMeta(story.id, { genre: value })
  )
  const memorySave = useAutosave((value: string) =>
    updateStoryMeta(story.id, { memory: value })
  )
  const authorsNoteSave = useAutosave((value: string) =>
    updateStoryMeta(story.id, { authorsNote: value })
  )
  const systemPromptSave = useAutosave((value: string) =>
    updateStoryMeta(story.id, { systemPrompt: value })
  )

  const titleRef = React.useRef<HTMLInputElement>(null)
  const descriptionRef = React.useRef<HTMLTextAreaElement>(null)
  const genreRef = React.useRef<HTMLInputElement>(null)
  const memoryRef = React.useRef<HTMLTextAreaElement>(null)
  const authorsNoteRef = React.useRef<HTMLTextAreaElement>(null)
  const systemPromptRef = React.useRef<HTMLTextAreaElement>(null)

  const titleField = useServerSyncedField(
    titleRef,
    story.title,
    titleSave.status
  )
  const descriptionField = useServerSyncedField(
    descriptionRef,
    story.description,
    descriptionSave.status
  )
  const genreField = useServerSyncedField(
    genreRef,
    story.genre,
    genreSave.status
  )
  const memoryField = useServerSyncedField(
    memoryRef,
    story.memory,
    memorySave.status
  )
  const authorsNoteField = useServerSyncedField(
    authorsNoteRef,
    story.authorsNote,
    authorsNoteSave.status
  )
  // "" is the honest rendering of a null override: the field shows the built-in
  // prompt as placeholder text, and clearing it stores NULL again.
  const systemPromptField = useServerSyncedField(
    systemPromptRef,
    story.systemPrompt ?? "",
    systemPromptSave.status
  )

  /**
   * Save a settings patch and tell the caller how it ended. Every caller must
   * do something with `resolve` — a control left waiting for the echo of a save
   * that failed stops following the server for good; see hooks/use-server-synced.ts.
   */
  const saveSettings = React.useCallback(
    (patch: Partial<GenerationSettings>, resolve?: (ok: boolean) => void) => {
      startTransition(async () => {
        let ok = false
        let message = FALLBACK_ERROR
        try {
          const result = await updateGenerationSettings(story.id, patch)
          ok = result.ok
          if (!result.ok) message = result.error
        } catch (error) {
          // A thrown action — a dropped connection mid-save — never reaches the
          // `ok` check, and would otherwise fail silently.
          message =
            error instanceof Error && error.message ? error.message : message
        }
        resolve?.(ok)
        if (!ok) toast.error(message)
      })
    },
    [story.id, startTransition]
  )

  // 0 means "neither the model nor the pinned endpoint is known to the catalog",
  // i.e. no clamp. A pinned endpoint wins: a third-party host commonly serves a
  // shorter window than the lab does, and that shorter window is the real ceiling.
  const liveContextLength =
    endpointForTag(endpoints, providerTag)?.contextLength ??
    models.find((m) => m.id === modelId)?.contextLength ??
    0

  // Holding the value mid-drag is not enough on its own: the ceiling it is
  // clamped against moves too — endpoints resolve, or another device switches
  // the model — and a ceiling that drops under a finger snaps the thumb to a
  // stop the writer never chose, which the release then persists.
  const windowDragProps = {
    onPointerDown: () => {
      setHeldContextLength(liveContextLength)
      startWindowDrag.onPointerDown()
    },
  }
  const contextLength = draggingWindow
    ? (heldContextLength ?? liveContextLength)
    : liveContextLength

  // A window stored while another model was selected can be larger than this one
  // allows. Clamped for display so the meter and the slider agree on a legal
  // stop immediately; the effect below is what makes the row agree too.
  const contextWindow = clampContextWindow(storedContextWindow, contextLength)

  // That display clamp is cosmetic until it is written, and every other reader
  // of the row has to defend itself against the difference — startGeneration
  // re-clamps for itself rather than trust it (lib/actions/generation.ts). Write
  // the fix-up from an effect, since saving during a render is not allowed, and
  // key it on the ceiling rather than on mount: `endpoints` arrive well after
  // mount, and the endpoint is frequently the binding constraint.
  const fixedUpRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (draggingWindow) return
    // A follower's window belongs to the profile, and the columns this would
    // write are the story's untouched custom memory — fixing them up here would
    // overwrite settings the writer expects to come back to, to no effect on
    // what actually generates. The profile editor clamps its own window.
    if (!isCustom) return
    const clamped = clampContextWindow(savedContextWindow, contextLength)
    if (clamped === savedContextWindow) return
    // The row only needs fixing once per ceiling. Without the latch StrictMode's
    // double invocation sends the same write twice, and with it two revalidations
    // and two fan-outs to every connected device.
    if (fixedUpRef.current === clamped) return
    fixedUpRef.current = clamped
    writeContextWindow(clamped)
    saveSettings({ contextWindow: clamped }, (ok) => {
      if (ok) settleContextWindow()
      else resetContextWindow(savedContextWindow)
    })
  }, [
    contextLength,
    savedContextWindow,
    draggingWindow,
    isCustom,
    saveSettings,
    writeContextWindow,
    settleContextWindow,
    resetContextWindow,
  ])

  function handleModelChange(nextModelId: string) {
    // Re-picking the model already in use is not a change, and running the rest
    // of this would drop the writer's provider pin for a click that chose
    // nothing. The combobox reports every selection, including that one.
    if (nextModelId === modelId) return
    const previous = {
      modelId,
      providerTag,
      thinking,
      contextWindow: storedContextWindow,
    }
    model.write(nextModelId)
    // A provider tag names an endpoint of the *old* model; the new one is served
    // by a different set, so the pin cannot survive the switch. Back to Auto.
    provider.write(null)
    const nextModel = models.find((m) => m.id === nextModelId)
    // Thinking levels are per-model: a level the new model doesn't offer (or
    // any level at all, on a model that can't think) falls back to off.
    const nextThinking = levelForModel(nextModel?.reasoning, thinking)
    thinkingSync.write(nextThinking)
    // Same story for the context window: a smaller model can't honour the stop
    // the writer picked under a bigger one. Both dependent settings ride along
    // in the one patch so the row is never briefly inconsistent. Clamped from
    // the *stored* window, not the displayed one — the display may be sitting
    // under an endpoint ceiling that this very patch is about to remove, and
    // writing that back would quietly forfeit the writer's real preference.
    const nextContextWindow = clampContextWindow(
      storedContextWindow,
      nextModel?.contextLength ?? 0
    )
    writeContextWindow(nextContextWindow)
    saveSettings(
      {
        modelId: nextModelId,
        providerTag: null,
        thinking: nextThinking,
        contextWindow: nextContextWindow,
      },
      (ok) => {
        if (ok) {
          model.settle()
          provider.settle()
          thinkingSync.settle()
          settleContextWindow()
        } else {
          model.reset(previous.modelId)
          provider.reset(previous.providerTag)
          thinkingSync.reset(previous.thinking)
          resetContextWindow(previous.contextWindow)
        }
      }
    )
  }

  function handleProviderChange(nextProviderTag: string | null) {
    if (nextProviderTag === providerTag) return
    const previous = { providerTag, contextWindow: storedContextWindow }
    provider.write(nextProviderTag)
    // Same clamp as a model change, for the same reason: the endpoint owns the
    // window, so pinning a smaller one has to pull the slider down with it.
    const nextContextWindow = clampContextWindow(
      storedContextWindow,
      endpointForTag(endpoints, nextProviderTag)?.contextLength ??
        models.find((m) => m.id === modelId)?.contextLength ??
        0
    )
    writeContextWindow(nextContextWindow)
    saveSettings(
      { providerTag: nextProviderTag, contextWindow: nextContextWindow },
      (ok) => {
        if (ok) {
          provider.settle()
          settleContextWindow()
        } else {
          provider.reset(previous.providerTag)
          resetContextWindow(previous.contextWindow)
        }
      }
    )
  }

  function handleThinkingChange(next: ThinkingLevel) {
    const previous = thinking
    thinkingSync.write(next)
    saveSettings({ thinking: next }, (ok) => {
      if (ok) thinkingSync.settle()
      else thinkingSync.reset(previous)
    })
  }

  function handleProfileChange(next: string | null) {
    if (next === profileId) return
    const previous = profileId
    const previousLastProfileId = lastProfileId
    // Only the pointer moves: the story's settings columns are its custom
    // memory, so a trip through a profile and back is lossless (§ Semantics).
    setLastProfileId(next === null ? previous : null)
    profile.write(next)
    startTransition(async () => {
      let ok = false
      let message = FALLBACK_ERROR
      try {
        const result = await setStoryProfile(story.id, next)
        ok = result.ok
        if (!result.ok) message = result.error
      } catch (error) {
        message =
          error instanceof Error && error.message ? error.message : message
      }
      if (ok) {
        profile.settle()
      } else {
        profile.reset(previous)
        // The switch never happened, so the "based on" memory is whatever it
        // was before it — clearing it would strand a Custom story's way back.
        setLastProfileId(previousLastProfileId)
        toast.error(message)
      }
    })
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      {/* Bottom pad clears the home indicator; see app/page.tsx. */}
      <div className="space-y-6 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="space-y-3">
          <ProfileCard
            profiles={profiles}
            profileId={profileId}
            defaultProfileId={defaultProfileId}
            onProfileChange={handleProfileChange}
            models={models}
            endpoints={endpoints}
            basedOnName={basedOnProfile?.name ?? null}
            onOpenChange={setProfileMenuOpen}
          />

          {/* Following a profile there is nothing here to tune: the bundle is
              global, and a knob in the story would be a silent fork of it. */}
          {isCustom ? (
            <div className="space-y-1">
              <ModelPicker
                models={models}
                value={modelId}
                onValueChange={handleModelChange}
                endpoints={endpoints}
                providerTag={providerTag}
                onProviderTagChange={handleProviderChange}
                thinking={thinking}
                onThinkingChange={handleThinkingChange}
                onOpenChange={setPickerOpen}
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
                  <SettingSlider
                    storyId={story.id}
                    field="temperature"
                    label="Temperature"
                    serverValue={story.settings.temperature}
                    min={0}
                    max={2}
                    step={0.01}
                  />
                  <SettingSlider
                    storyId={story.id}
                    field="topP"
                    label="Top P"
                    serverValue={story.settings.topP}
                    min={0}
                    max={1}
                    step={0.01}
                  />
                  <SettingSlider
                    storyId={story.id}
                    field="maxTokens"
                    label="Max tokens"
                    serverValue={story.settings.maxTokens}
                    min={128}
                    max={4096}
                    step={128}
                  />
                  <ContextWindowSlider
                    value={contextWindow}
                    contextLength={contextLength}
                    dragProps={windowDragProps}
                    onValueChange={setContextWindowLocal}
                    onValueCommitted={(next) => {
                      // A release that settled back on the stored stop is not a
                      // change; anything else is, including a return to a stop
                      // the model clamp moved us off earlier.
                      const previous = savedContextWindow
                      writeContextWindow(next)
                      if (next === previous) return
                      saveSettings({ contextWindow: next }, (ok) => {
                        if (ok) settleContextWindow()
                        else resetContextWindow(previous)
                      })
                    }}
                  />
                  <SettingSlider
                    storyId={story.id}
                    field="frequencyPenalty"
                    label="Frequency penalty"
                    serverValue={story.settings.frequencyPenalty}
                    min={-2}
                    max={2}
                    step={0.1}
                  />
                  <SettingSlider
                    storyId={story.id}
                    field="presencePenalty"
                    label="Presence penalty"
                    serverValue={story.settings.presencePenalty}
                    min={-2}
                    max={2}
                    step={0.1}
                  />
                </CollapsibleContent>
              </Collapsible>

              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  onClick={() => setSaveProfileOpen(true)}
                >
                  Save as profile…
                </Button>
                {basedOnProfile ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="min-w-0 text-muted-foreground"
                    onClick={() => handleProfileChange(basedOnProfile.id)}
                  >
                    <span className="truncate">
                      Back to {basedOnProfile.name}
                    </span>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <ContextMeter
            story={story}
            lorebookEntries={lorebookEntries}
            contextWindow={contextWindow}
          />
        </div>

        <SaveProfileDialog
          storyId={story.id}
          open={saveProfileOpen}
          onOpenChange={setSaveProfileOpen}
          onSaved={(id) => {
            // The action already pointed the story at the new profile, so this
            // only catches the switcher up; the fresh props are on their way in
            // the same transition.
            setLastProfileId(null)
            profile.write(id)
            profile.settle()
          }}
        />

        <Separator />

        <div className="space-y-2">
          <Label htmlFor={`${uid}-title`}>Title</Label>
          <Input
            id={`${uid}-title`}
            ref={titleRef}
            defaultValue={story.title}
            aria-invalid={titleEmpty || undefined}
            placeholder="Untitled Story"
            onChange={(event) => {
              const next = event.target.value
              const empty = next.trim() === ""
              setTitleEmpty(empty)
              if (empty) {
                // An empty title is rejected by the action, and the half-deleted
                // value still sitting in the debounce must not outlive it —
                // blur (or navigation) would otherwise persist "S".
                titleSave.cancel()
                return
              }
              // What the row will hold, not what was typed: updateStoryMeta
              // trims, and an echo that can never match would latch the field
              // shut against every later rename.
              titleField.markWritten(next.trim())
              titleSave.schedule(next)
            }}
            onBlur={() => {
              const el = titleRef.current
              if (el && el.value.trim() === "") {
                // Nothing was saved for the empty value: put the stored title
                // back so the field, the header and the library agree.
                titleField.restore(story.title)
                setTitleEmpty(false)
                return
              }
              titleSave.flush()
            }}
          />
          <p className="text-xs text-muted-foreground">
            {titleEmpty
              ? "A title is required."
              : "Shown in the library and the story header."}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${uid}-description`}>Description</Label>
          <Textarea
            id={`${uid}-description`}
            ref={descriptionRef}
            defaultValue={story.description}
            className="min-h-16"
            placeholder="A sentence or two about this story…"
            onChange={(event) => {
              descriptionField.markWritten(event.target.value)
              descriptionSave.schedule(event.target.value)
            }}
            onBlur={() => descriptionSave.flush()}
          />
          <p className="text-xs text-muted-foreground">
            The pitch shown beside the story in the library.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${uid}-genre`}>Genre</Label>
          <Input
            id={`${uid}-genre`}
            ref={genreRef}
            defaultValue={story.genre}
            placeholder="Literary fiction"
            onChange={(event) => {
              genreField.markWritten(event.target.value)
              genreSave.schedule(event.target.value)
            }}
            onBlur={() => genreSave.flush()}
          />
          <p className="text-xs text-muted-foreground">
            Used for the library badge and search.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${uid}-memory`}>Memory</Label>
          <Textarea
            id={`${uid}-memory`}
            ref={memoryRef}
            defaultValue={story.memory}
            className="min-h-24"
            placeholder="Facts the model should always remember…"
            onChange={(event) => {
              memoryField.markWritten(event.target.value)
              memorySave.schedule(event.target.value)
            }}
            onBlur={() => memorySave.flush()}
          />
          <p className="text-xs text-muted-foreground">
            Always included at the top of context.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${uid}-authors-note`}>Author&apos;s note</Label>
          <Textarea
            id={`${uid}-authors-note`}
            ref={authorsNoteRef}
            defaultValue={story.authorsNote}
            className="min-h-16"
            placeholder="Steer tone and style…"
            onChange={(event) => {
              authorsNoteField.markWritten(event.target.value)
              authorsNoteSave.schedule(event.target.value)
            }}
            onBlur={() => authorsNoteSave.flush()}
          />
          <p className="text-xs text-muted-foreground">
            Injected near the most recent words.
          </p>
        </div>

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
            System prompt
            <ChevronsUpDown className="size-3" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-3">
            <Label htmlFor={`${uid}-system-prompt`} className="sr-only">
              System prompt
            </Label>
            <Textarea
              id={`${uid}-system-prompt`}
              ref={systemPromptRef}
              defaultValue={story.systemPrompt ?? ""}
              className="min-h-48 font-mono text-xs"
              // The built-in prompt as placeholder: it is what actually runs
              // when the field is empty, so it belongs in the box, greyed out.
              placeholder={DEFAULT_SYSTEM_PROMPT}
              onChange={(event) => {
                const next = event.target.value
                // Blank is stored as NULL and comes back as "" (see the field
                // above); anything else is stored verbatim.
                systemPromptField.markWritten(next.trim() === "" ? "" : next)
                systemPromptSave.schedule(next)
              }}
              onBlur={() => systemPromptSave.flush()}
            />
            <p className="text-xs text-muted-foreground">
              How the narrator writes. Replaces the built-in prompt shown here;
              clear it to go back.
            </p>
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        <div className="space-y-3">
          <Label>Lorebook</Label>
          <LoreTab story={story} lorebookEntries={lorebookEntries} />
        </div>
      </div>
    </ScrollArea>
  )
}

/**
 * 812 -> "812"; 1234 -> "1.2k"; 24000 -> "24k". Lowercase "k" so the numerator
 * matches the ladder label it is printed against ("≈ 4.2k / 8k tokens").
 */
function formatApproxTokens(tokens: number): string {
  if (tokens >= 10_000) return `${Math.round(tokens / 1_000)}k`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return `${tokens}`
}

/**
 * How much of the selected context window the next request would occupy.
 * Composed client-side from the same pure function the server uses to build the
 * real prompt, and against the same budget — so the number the writer sees is
 * the number that gets sent. The window is the *live* slider value, not
 * story.settings, so the meter answers before the commit round-trips.
 *
 * It is also the way in to the viewer for a request that has not happened yet.
 * The same breakdown a finished passage shows, composed here instead of read
 * from disk: what the lorebook is contributing, and what the window is about to
 * push out — answerable while the slider is still under the writer's finger,
 * rather than only after a generation has spent the money.
 */
function ContextMeter({
  story,
  lorebookEntries,
  contextWindow,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
  /** Selected, model-clamped input budget in tokens. Always a ladder stop. */
  contextWindow: number
}) {
  const [open, setOpen] = React.useState(false)
  const context = React.useMemo(
    () => composeContext({ story, lorebookEntries, contextWindow }),
    [story, lorebookEntries, contextWindow]
  )
  const approxTokens = context.approxTokens
  // Only while the dialog is open: this runs on every keystroke in the panel
  // otherwise, to build something nobody is looking at.
  const breakdown = React.useMemo(
    () => (open ? describeContext(context, contextWindow) : null),
    [open, context, contextWindow]
  )

  const used = formatApproxTokens(approxTokens)
  const budget = contextWindowLabel(contextWindow)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // A button's subtree is presentational, so a progressbar and a readout
        // nested inside one reach no screen reader. The numbers have to BE the
        // name, or opening the dialog becomes the only way to hear them.
        aria-label={`Context used: about ${used} of ${budget} tokens. View the context for the next generation.`}
        className="block w-full space-y-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <span className="block font-mono text-xs text-muted-foreground tabular-nums">
          ≈ {used} / {budget} tokens
        </span>
        {/* The smallest stops cannot fit the system prompt alone, so the bar can
            be pinned full (Meter clamps) while the readout above honestly shows
            the overflow. */}
        <Meter
          value={approxTokens / contextWindow}
          indicatorClassName="transition-[width] duration-200"
          aria-hidden
        />
      </button>
      <ContextDialog
        open={open}
        onOpenChange={setOpen}
        caption="Context for the next generation"
        breakdown={breakdown}
      />
    </>
  )
}
