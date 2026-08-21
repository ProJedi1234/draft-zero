"use client"

// hooks/use-model-settings.ts — Everything the inspector's model section knows,
// lifted out of the component that used to render it.
//
// A hook rather than state inside <ModelSection> because two other things read
// these values. The status strip prints the live model identity and the context
// window, and both have to be the *controls'* values rather than the story's:
// in Custom mode the picker is ahead of the row for the length of a save, and a
// strip reading story.settings would spend that time disagreeing with the
// combobox above it. Pushing the state down into the section would put it out
// of the strip's reach; lifting it here keeps one copy with one owner.
//
// The reconciliation rules this coordinates are documented in
// hooks/use-server-synced.ts — in particular, every save must resolve its
// control with settle() or reset(), or that control stops following the server
// for the life of the mount.

import * as React from "react"
import { toast } from "sonner"

import { levelForModel } from "@/components/thinking-select"
import { useDragHold } from "@/hooks/use-drag-hold"
import { useModelEndpoints } from "@/hooks/use-model-endpoints"
import { useServerSyncedValue } from "@/hooks/use-server-synced"
import { setStoryProfile } from "@/lib/actions/profiles"
import { updateGenerationSettings } from "@/lib/actions/stories"
import {
  clampContextWindow,
  routableEndpointForTag,
  type GenerationSettings,
  type ModelProfile,
  type OpenRouterModel,
  type Story,
  type ThinkingLevel,
} from "@/lib/types"

const FALLBACK_ERROR = "Couldn't save your changes."

export function useModelSettings({
  story,
  models,
  profiles,
}: {
  story: Story
  models: OpenRouterModel[]
  profiles: ModelProfile[]
}) {
  // These depend on each other, so any open menu holds all of them: adopting a
  // foreign model while the writer is reading one of them would retarget the
  // endpoint list under the cursor, or unmount the thinking menu outright — and
  // a profile arriving mid-menu would swap the whole section out from under it.
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = React.useState(false)
  const menuOpen = pickerOpen || profileMenuOpen
  // Which mode the story is in. Following a profile, the settings below are the
  // profile's and nothing here may write them; Custom, they are the story's own.
  const profile = useServerSyncedValue(story.profileId, {
    hold: menuOpen,
    version: story.updatedAt,
  })
  const profileId = profile.value
  // The switch is not over when the action resolves — it is over when the tree
  // comes back carrying it, because everything below this card is still the old
  // profile's until then. The context meter in particular reads the story's
  // resolved settings, so it answers with the previous window for the length of
  // the round trip, and there is nothing on screen to say so. This comparison
  // IS that gap: the card is showing one profile and the props still say
  // another. It clears the instant the numbers underneath become true.
  const profileSwitching = profileId !== story.profileId
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
    version: story.updatedAt,
  })
  const thinkingSync = useServerSyncedValue(story.settings.thinking, {
    hold: menuOpen,
    version: story.updatedAt,
  })
  const provider = useServerSyncedValue(story.settings.providerTag, {
    hold: menuOpen,
    version: story.updatedAt,
  })
  // The EFFECTIVE policy: story.settings has the app-wide floor already ORed
  // in, so a story under it shows on here even though its own column says
  // false. The switch that reads this is locked in that case, so the two can
  // never disagree about what a click would do.
  const zdrSync = useServerSyncedValue(story.settings.zdr, {
    hold: menuOpen,
    version: story.updatedAt,
  })
  const modelId = model.value
  const thinking = thinkingSync.value
  const providerTag = provider.value
  const zdr = zdrSync.value
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
    version: story.updatedAt,
  })
  const [, startTransition] = React.useTransition()

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
    routableEndpointForTag(endpoints, providerTag, zdr)?.contextLength ??
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
      routableEndpointForTag(endpoints, nextProviderTag, zdr)?.contextLength ??
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

  function handleZdrChange(next: boolean) {
    const previous = zdr
    zdrSync.write(next)
    saveSettings({ zdr: next }, (ok) => {
      if (ok) zdrSync.settle()
      else zdrSync.reset(previous)
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

  /** Catch the switcher up after "Save as profile…" pointed the story at a new one. */
  function adoptSavedProfile(id: string) {
    setLastProfileId(null)
    profile.write(id)
    profile.settle()
  }

  return {
    // identity, live — what the controls have, not what the row has
    modelId,
    providerTag,
    thinking,
    zdr,
    endpoints,
    // profile mode
    profileId,
    profileSwitching,
    isCustom,
    basedOnProfile,
    setPickerOpen,
    setProfileMenuOpen,
    saveProfileOpen,
    setSaveProfileOpen,
    // context window
    contextWindow,
    contextLength,
    savedContextWindow,
    windowDragProps,
    setContextWindowLocal,
    writeContextWindow,
    settleContextWindow,
    resetContextWindow,
    // writes
    saveSettings,
    handleModelChange,
    handleProviderChange,
    handleThinkingChange,
    handleZdrChange,
    handleProfileChange,
    adoptSavedProfile,
  }
}

export type ModelSettings = ReturnType<typeof useModelSettings>
