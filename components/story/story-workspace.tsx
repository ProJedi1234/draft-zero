"use client"

import * as React from "react"

import type {
  ComposerDraft,
  ComposerMode,
  ImageAspectRatio,
  LorebookEntry,
  ModelProfile,
  OpenRouterImageModel,
  OpenRouterModel,
  Story,
  StoryCostProfile,
  StoryImage,
} from "@/lib/types"
import { runHandoff } from "@/lib/sync/client"
import type { DraftPayload } from "@/lib/sync/draft"
import { matchBriefLore, selectBriefLore } from "@/lib/images/brief-lore"
import { composeSentPrompt, splitSentPrompt } from "@/lib/images/styles"
import {
  useComposerDraftSync,
  type AdoptedDraft,
} from "@/hooks/use-composer-draft-sync"
import {
  useGeneration,
  type GenerationController,
} from "@/hooks/use-generation"
import {
  useImageGeneration,
  useImagePromptDerivation,
} from "@/hooks/use-image-generation"
import {
  InspectorContent,
  InspectorPanel,
  type InspectorTab,
} from "@/components/inspector/inspector-panel"
import { Composer } from "@/components/story/composer"
import { ImageRetryModelsProvider } from "@/components/story/image-retry-button"
import { FocusExitButton } from "@/components/story/focus-exit-button"
import { RetryProfilesProvider } from "@/components/story/retry-profile-menu"
import { StoryCanvas } from "@/components/story/story-canvas"
import { StoryHeader } from "@/components/story/story-header"
import { StoryTint } from "@/components/story/story-tint"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useSidebar } from "@/components/ui/sidebar"

/** Workspace preferences are the writer's, not the story's — they survive reloads. */
const INSPECTOR_STORAGE_KEY = "draft-zero:inspector-open"
const INSPECTOR_TAB_STORAGE_KEY = "draft-zero:inspector-tab"

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect

/**
 * The workspace shell. Everything here is deliberately OUTSIDE the story-keyed
 * subtree: inspector visibility is a preference of the writer, not a property
 * of the story, and remounting it on every navigation would slam the inspector
 * back open. (The armed Say/Do move used to live out here too, for the same
 * reason — it moved into the editor when it became synced, per-story state:
 * see composer_drafts.mode in the schema.)
 */
export function StoryWorkspace({
  story,
  composerDraft,
  lorebookEntries,
  models,
  imageModels,
  imageModelPrice,
  defaultImageModelId,
  costProfile,
  profiles,
  defaultProfileId,
  requireZdr,
}: {
  story: Story
  /** The unsent composer text as the DB last saw it — the editor's seed. */
  composerDraft: ComposerDraft | null
  lorebookEntries: LorebookEntry[]
  models: OpenRouterModel[]
  /** The image catalog — a separate endpoint and a separate shape; see lib/images/models.ts. */
  imageModels: OpenRouterImageModel[]
  /** What the story's selected image model costs per image, or null when unknown. */
  imageModelPrice: string | null
  /** What a null story choice resolves to — the picker's "Default" row names it. */
  defaultImageModelId: string
  /** Server-read spend for this story — the header chip's ledger. */
  costProfile: StoryCostProfile
  /** Every profile, in the writer's order — the inspector's switcher list. */
  profiles: ModelProfile[]
  /** The profile new stories start from; starred in the switcher. */
  defaultProfileId: string | null
  /** The app-wide retention policy, for the inspector's zero-data-retention switch. */
  requireZdr: boolean
}) {
  const [inspectorOpen, setInspectorOpen] = useInspectorOpen()
  const [inspectorTab, setInspectorTab] = useInspectorTab()
  const [mobileInspectorOpen, setMobileInspectorOpen] = React.useState(false)
  const closeMobileInspector = React.useCallback(
    () => setMobileInspectorOpen(false),
    []
  )
  const [focusMode, toggleFocusMode] = useFocusMode(closeMobileInspector)
  useFocusModeShortcut(toggleFocusMode)

  // The sync channel itself lives in the root layout (components/
  // sync-listener.tsx) so the library and settings pages hear `change` too;
  // this workspace only registers as the run-started target while mounted.
  // The ref bridges to the keyed editor below: the generation hook writes its
  // attach function into it, and a `run-started` from another device calls
  // through — which is the entire multi-device story; there is deliberately
  // nothing to see.
  const attachRef = React.useRef<((runId: string | null) => void) | null>(null)
  // The image run's twin bridge — its own ref because the two runs are
  // independent and each hook owns its own channel.
  const imageAttachRef = React.useRef<((runId: string | null) => void) | null>(
    null
  )
  // And the develop's, for the third channel — one bridge per registry.
  const deriveAttachRef = React.useRef<((runId: string | null) => void) | null>(
    null
  )
  // The draft's twin bridge: `draft` events reach the editor through the
  // draftRelay directly, but events missed while the socket was down do not —
  // this is how the reconnect asks the editor to re-read the row.
  const draftResyncRef = React.useRef<(() => void) | null>(null)
  React.useEffect(() => {
    runHandoff.current = {
      storyId: story.id,
      onRunStarted: (runId) => attachRef.current?.(runId),
      onImageRunStarted: (runId) => imageAttachRef.current?.(runId),
      onDeriveRunStarted: (runId) => deriveAttachRef.current?.(runId),
      // A reconnect means run-started events may have been missed while the
      // socket was down; a null attach is the "is anything running?" probe —
      // one per channel. The draft probe rides the same moment.
      onReconnect: () => {
        attachRef.current?.(null)
        imageAttachRef.current?.(null)
        deriveAttachRef.current?.(null)
        draftResyncRef.current?.()
      },
    }
    return () => {
      runHandoff.current = null
    }
  }, [story.id])

  return (
    // story-ambient is the room's light source: a glow near the top and a
    // vignette at the edges. It belongs on the workspace, not on the editor
    // column inside it — scoped to the column, the gradient began at the
    // header's bottom border, so the colour appeared to slide UNDER a flat
    // grey bar and the header read as a lid rather than part of the room. The
    // header paints no background of its own, so lighting the workspace lights
    // it too. Both gradient stops equal --background at strength 0, so an
    // untinted story gets a gradient from the page colour to itself — nothing
    // to see, and nothing to switch off.
    //
    // The inspector still paints an opaque --background and so stops the
    // gradient at its own left border. That seam is known and deliberately
    // left: closing it means making the panel translucent, which is a
    // question about what the inspector IS, not about where the light comes
    // from.
    <div className="relative flex h-app min-w-0 flex-col story-ambient">
      {/* Document-wide, and only while a story is open — see StoryTint. */}
      <StoryTint hue={story.tintHue} strength={story.tintStrength} />
      <StoryHeader
        story={story}
        costProfile={costProfile}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen(!inspectorOpen)}
        onOpenMobileInspector={() => setMobileInspectorOpen(true)}
        focusMode={focusMode}
        onEnterFocusMode={toggleFocusMode}
      />
      {/* Only reachable while focus mode is on, so the toggle IS the exit. */}
      {focusMode && <FocusExitButton onExit={toggleFocusMode} />}
      <div className="flex min-h-0 flex-1">
        {/* Keyed here, not on the workspace: generation state and the
            uncontrolled-after-mount fields (§4.2) must reset per story. */}
        <ImageRetryModelsProvider
          value={{
            models: imageModels,
            zdr: story.settings.zdr,
            // What plain Retry actually draws with — resolved the same way
            // the server resolves it, so the menu's "current" mark and the
            // footer name the model the button beside them really runs.
            currentModelId: story.imageModelId ?? defaultImageModelId,
          }}
        >
          <StoryEditor
            key={story.id}
            story={story}
            composerDraft={composerDraft}
            lorebookEntries={lorebookEntries}
            models={models}
            profiles={profiles}
            defaultProfileId={defaultProfileId}
            attachRef={attachRef}
            imageAttachRef={imageAttachRef}
            deriveAttachRef={deriveAttachRef}
            draftResyncRef={draftResyncRef}
          />
        </ImageRetryModelsProvider>
        <InspectorPanel
          story={story}
          lorebookEntries={lorebookEntries}
          models={models}
          imageModels={imageModels}
          imageModelPrice={imageModelPrice}
          defaultImageModelId={defaultImageModelId}
          profiles={profiles}
          defaultProfileId={defaultProfileId}
          requireZdr={requireZdr}
          tab={inspectorTab}
          onTabChange={setInspectorTab}
          collapsed={!inspectorOpen || focusMode}
        />
      </div>

      <Sheet open={mobileInspectorOpen} onOpenChange={setMobileInspectorOpen}>
        {/* Full-bleed on a phone, 20rem from sm up; see SheetContent. The
            inspector is the densest surface in the app — three segments, a
            status strip, and two comboboxes — and it was being read through a
            three-quarter-width slot with the manuscript still showing. */}
        <SheetContent
          side="right"
          className="gap-0 pt-[env(safe-area-inset-top)] lg:hidden"
          style={{ "--sheet-width": "20rem" } as React.CSSProperties}
        >
          <SheetHeader className="border-b p-4">
            <SheetTitle className="text-sm">Inspector</SheetTitle>
          </SheetHeader>
          <InspectorContent
            story={story}
            lorebookEntries={lorebookEntries}
            models={models}
            imageModels={imageModels}
            imageModelPrice={imageModelPrice}
            defaultImageModelId={defaultImageModelId}
            profiles={profiles}
            defaultProfileId={defaultProfileId}
            requireZdr={requireZdr}
            tab={inspectorTab}
            onTabChange={setInspectorTab}
          />
        </SheetContent>
      </Sheet>
    </div>
  )
}

/** Canvas + composer + generation: the part that is per-story. */
function StoryEditor({
  story,
  composerDraft,
  lorebookEntries,
  models,
  profiles,
  defaultProfileId,
  attachRef,
  imageAttachRef,
  deriveAttachRef,
  draftResyncRef,
}: {
  story: Story
  /** The unsent draft the DB holds — seeded once at mount, live after that. */
  composerDraft: ComposerDraft | null
  /** For the brief's lore chips, matched here rather than on the server. */
  lorebookEntries: LorebookEntry[]
  /** For the retry menu's one-line summary of each profile. */
  models: OpenRouterModel[]
  profiles: ModelProfile[]
  defaultProfileId: string | null
  /** Bridge from the workspace's sync channel: run-started → attach mid-flight; null = re-probe. */
  attachRef: { current: ((runId: string | null) => void) | null }
  /** Same bridge for the image channel — image-run-started lands here. */
  imageAttachRef: { current: ((runId: string | null) => void) | null }
  /** Same bridge for the derivation channel — derive-run-started lands here. */
  deriveAttachRef: { current: ((runId: string | null) => void) | null }
  /** The draft's bridge: a reconnect calls through to re-read the row. */
  draftResyncRef: { current: (() => void) | null }
}) {
  // Seeded from the DB row once — the editor remounts per story (key above),
  // and after mount the pair belongs to this state, fed by keystrokes on this
  // device and `draft` events from the others. RSC refreshes deliver newer
  // composerDraft props, and they are deliberately ignored: the wire is the
  // live channel, and re-seeding from a refetch would be a second, slower
  // opinion arriving out of order.
  //
  // Mode is owned here now, per story, where it used to be the workspace's:
  // once the armed move syncs and is remembered per story, it IS story state,
  // and switching stories arming what each one last used is the point.
  const [draft, setDraft] = React.useState(composerDraft?.text ?? "")
  const [mode, setMode] = React.useState<ComposerMode>(
    composerDraft?.mode ?? "do"
  )
  // The image lane's four, seeded and synced exactly like the pair above.
  // `imagePrompt` is the DISPLAYED developed prompt, which during a develop
  // call is a half-written sentence; what has actually been published lives in
  // the ref below, and the two deliberately disagree mid-stream.
  const [imagePrompt, setImagePrompt] = React.useState(
    composerDraft?.imagePrompt ?? null
  )
  const [imageAssisted, setImageAssisted] = React.useState(
    composerDraft?.imageAssisted ?? true
  )
  const [imageStyle, setImageStyle] = React.useState(
    composerDraft?.imageStyle ?? null
  )
  // Which lore chips the writer has muted, per send rather than per story: an
  // exclusion is an edit to ONE develop call — "not this time" — and carrying
  // it forward would quietly turn a tap into a lorebook setting nobody can see.
  // Per send, but not per DEVICE: it rides the draft row with the brief it
  // qualifies, so a chip tapped off on the phone is off on the tablet that hits
  // ↵. Mutes for entries the brief no longer matches are simply never rendered.
  const [excludedLoreIds, setExcludedLoreIds] = React.useState<Set<string>>(
    () => new Set(composerDraft?.imageExcludedLoreIds ?? [])
  )
  // For callbacks that need "what is the composer holding right now" without
  // subscribing to every keystroke. Written synchronously by the change
  // wrappers below, because a suggestion chip sets mode and text in the same
  // tick and the second publish must already see the first value; the effect
  // keeps them honest across foreign adoptions.
  const draftRef = React.useRef(draft)
  const modeRef = React.useRef(mode)
  const imagePromptRef = React.useRef(imagePrompt)
  const imageAssistedRef = React.useRef(imageAssisted)
  const imageStyleRef = React.useRef(imageStyle)
  const excludedLoreRef = React.useRef(excludedLoreIds)
  React.useEffect(() => {
    draftRef.current = draft
    modeRef.current = mode
    imageAssistedRef.current = imageAssisted
    imageStyleRef.current = imageStyle
    excludedLoreRef.current = excludedLoreIds
    // imagePromptRef is NOT reconciled here: it is the published value, and
    // this effect runs on every streamed chunk of a develop call.
  })
  const adoptDraft = React.useCallback((adopted: AdoptedDraft) => {
    setDraft(adopted.text)
    if (adopted.mode !== undefined) setMode(adopted.mode)
    if (adopted.imagePrompt !== undefined) {
      imagePromptRef.current = adopted.imagePrompt
      setImagePrompt(adopted.imagePrompt)
    }
    if (adopted.imageAssisted !== undefined)
      setImageAssisted(adopted.imageAssisted)
    if (adopted.imageStyle !== undefined) setImageStyle(adopted.imageStyle)
    if (adopted.imageExcludedLoreIds !== undefined)
      setExcludedLoreIds(new Set(adopted.imageExcludedLoreIds))
  }, [])
  /**
   * Drop every mute. Through the ref as well as the state because the callers
   * publish in the same tick — a queued setState would still be showing the old
   * set when the payload is read.
   */
  const clearExcludedLore = React.useCallback(() => {
    if (excludedLoreRef.current.size === 0) return
    excludedLoreRef.current = new Set()
    setExcludedLoreIds(excludedLoreRef.current)
  }, [])
  const draftSync = useComposerDraftSync({
    storyId: story.id,
    initialVersion: composerDraft?.updatedAt ?? null,
    adopt: adoptDraft,
    resyncRef: draftResyncRef,
  })
  const publishDraft = draftSync.publish
  const flushDraft = draftSync.flush
  /** The whole unsent state as the other devices should see it right now. */
  const draftPayload = React.useCallback(
    (): DraftPayload => ({
      text: draftRef.current,
      mode: modeRef.current,
      imagePrompt: imagePromptRef.current,
      imageAssisted: imageAssistedRef.current,
      imageStyle: imageStyleRef.current,
      imageExcludedLoreIds: [...excludedLoreRef.current],
    }),
    []
  )
  // Every USER-driven change goes through these so the other devices hear it.
  // Foreign adoptions go through adoptDraft above instead — routing them
  // through here would echo every adopted value straight back onto the bus.
  const changeDraft = React.useCallback(
    (value: string) => {
      draftRef.current = value
      setDraft(value)
      // A cleared brief is a cleared question, so the answers to it go too —
      // through the ref first, because the publish below is the one that
      // carries the clear to the other devices.
      if (value.trim() === "") clearExcludedLore()
      publishDraft(draftPayload())
    },
    [clearExcludedLore, draftPayload, publishDraft]
  )
  /** A chip tapped on or off. Publishes, like every other user-driven change. */
  const toggleLore = React.useCallback(
    (id: string) => {
      const next = new Set(excludedLoreRef.current)
      if (!next.delete(id)) next.add(id)
      excludedLoreRef.current = next
      setExcludedLoreIds(next)
      publishDraft(draftPayload())
    },
    [draftPayload, publishDraft]
  )
  const changeMode = React.useCallback(
    (value: ComposerMode) => {
      modeRef.current = value
      setMode(value)
      publishDraft(draftPayload())
    },
    [draftPayload, publishDraft]
  )
  /** A finished develop, or a hand-edit of the lane — both worth persisting. */
  const changeImagePrompt = React.useCallback(
    (value: string | null) => {
      imagePromptRef.current = value
      setImagePrompt(value)
      publishDraft(draftPayload())
    },
    [draftPayload, publishDraft]
  )
  const changeImageAssisted = React.useCallback(
    (value: boolean) => {
      imageAssistedRef.current = value
      setImageAssisted(value)
      publishDraft(draftPayload())
    },
    [draftPayload, publishDraft]
  )
  const changeImageStyle = React.useCallback(
    (value: string | null) => {
      imageStyleRef.current = value
      setImageStyle(value)
      publishDraft(draftPayload())
    },
    [draftPayload, publishDraft]
  )
  const composerRef = React.useRef<HTMLTextAreaElement>(null)
  const composerBoxRef = React.useRef<HTMLDivElement>(null)
  const shellRef = React.useRef<HTMLDivElement>(null)

  /**
   * Puts a picture's prompt back in the composer as the two lanes it came from.
   *
   * With a brief on record the pair is restored whole — the writer's words in
   * the brief, the developed prompt in the lane, ready to draw — because they
   * paid for the second one and the first is the only thing they can usefully
   * edit. Without one there is only ever one text, and it goes where the writer
   * types, exactly as it did before briefs existed.
   *
   * The stored prompt carries its style sentence, so it is peeled off on the
   * way in: leaving it would send the style twice on the next draw.
   */
  const restoreImagePrompt = React.useCallback(
    (restored: { prompt: string; sourcePrompt: string | null }) => {
      const { scene } = splitSentPrompt(restored.prompt)
      if (restored.sourcePrompt !== null) {
        changeDraft(restored.sourcePrompt)
        changeImagePrompt(scene)
      } else {
        changeDraft(scene)
        changeImagePrompt(null)
      }
      // Armed for image, because the restored text IS an image prompt: handing
      // it back under Do would leave the next Send about to file a scene
      // description as the writer's turn.
      changeMode("image")
    },
    [changeDraft, changeImagePrompt, changeMode]
  )

  const image = useImageGeneration(story.id, {
    onRestoreDraft: (restored) => {
      // Only into an EMPTY composer. A failed retry (fired from the picture's
      // own cluster, not from here) must not overwrite a sentence the writer is
      // halfway through typing — losing live keystrokes to a background failure
      // is a worse trade than losing a prompt they can regenerate.
      if (draftRef.current === "") restoreImagePrompt(restored)
      else changeMode("image")
    },
  })
  // The bridge from the workspace's sync registration: an image-run-started
  // (or the reconnect probe) calls through to whatever editor is mounted.
  const attachImage = image.attach
  React.useEffect(() => {
    imageAttachRef.current = attachImage
    return () => {
      imageAttachRef.current = null
    }
  }, [imageAttachRef, attachImage])

  // The develop is a server-owned run now, so this hook is a watcher like the
  // image one: it never publishes the streaming lane, and the settled prompt
  // comes back as a `draft` event the run itself writes — which is what makes
  // a develop survive the tab that started it.
  const derivation = useImagePromptDerivation(story.id, {
    // Display only. A prompt still being written is not a draft worth shipping
    // to the writer's other devices a chunk at a time.
    onText: setImagePrompt,
    // A develop that produced nothing (an error, a story deleted under it)
    // folds the lane away rather than leaving an empty box open. Only the
    // device that asked writes that down; the others hear it as the echo.
    onDiscard: ({ persist }) => {
      if (persist) changeImagePrompt(null)
      else setImagePrompt(null)
    },
  })
  // The bridge from the workspace's sync registration, exactly like the image
  // one: a derive-run-started (or the reconnect probe) calls through.
  const attachDerive = derivation.attach
  React.useEffect(() => {
    deriveAttachRef.current = attachDerive
    return () => {
      deriveAttachRef.current = null
    }
  }, [deriveAttachRef, attachDerive])

  const { develop } = derivation
  const handleDevelop = React.useCallback(() => {
    // The pending draft save goes out NOW rather than on its debounce. The run
    // writes the lane into the same row when it settles, seconds from here, and
    // a keystroke's save still in flight at that moment would land after it and
    // put the old lane back. Flushing here orders the two by the only thing
    // that can order them — arrival — and it also empties the pending slot, so
    // the run's own `draft` event is adoptable when it arrives (see
    // shouldAdoptDraft). A no-op when nothing is pending.
    flushDraft()
    void develop({
      brief: draftRef.current.trim(),
      excludedLoreIds: [...excludedLoreRef.current],
    })
  }, [develop, flushDraft])

  // Matched here, with the same function the server uses, so a chip on screen
  // and an entry in the call can never be two different lists. Cheap enough to
  // run per keystroke — it is a substring scan over the story's own lorebook —
  // and skipped entirely outside the one mode that shows it.
  const loreMatches = React.useMemo(
    () =>
      mode === "image" && imageAssisted
        ? matchBriefLore(lorebookEntries, draft)
        : [],
    [draft, imageAssisted, lorebookEntries, mode]
  )
  // What actually rides: the same selection the route makes from the same
  // inputs — muted chips out, then the shared budget. Recorded on the draw as
  // the picture's provenance, so it must be THIS list and not the chips' —
  // when the budget bites, a chip on screen may still be an entry that fell
  // off the far end of the cascade.
  const includedLoreIds = React.useMemo(
    () =>
      mode === "image" && imageAssisted
        ? selectBriefLore(lorebookEntries, draft, excludedLoreIds).map(
            (match) => match.entry.id
          )
        : [],
    [draft, excludedLoreIds, imageAssisted, lorebookEntries, mode]
  )
  // Remembered across sends, like the armed mode: a writer working in portrait
  // is working in portrait until they say otherwise.
  const [aspectRatio, setAspectRatio] = React.useState<ImageAspectRatio>("16:9")

  const generation = useGeneration(story, {
    // The composer clears the moment a move dispatches, so until the server has
    // written the row the textarea is the only copy of what the writer typed.
    onRestoreDraft: changeDraft,
    attachRef,
  })

  // Wrapped rather than passed straight through: both callers hang this off a
  // button's onClick, and retryLast's first parameter is a profile id.
  const { retryLast } = generation
  const handleRetry = React.useCallback(() => {
    retryLast()
  }, [retryLast])

  // Supplied to the composer's Retry and to every passage's, which are the same
  // control in two places. Memoised because the passage blocks are memoised:
  // a fresh object here would re-render the whole manuscript on every keystroke
  // in the composer.
  const retryProfiles = React.useMemo(
    () => ({
      profiles,
      models,
      defaultProfileId,
      currentProfileId: story.profileId,
      onRetryWithProfile: (profileId: string) => retryLast(profileId),
    }),
    [profiles, models, defaultProfileId, story.profileId, retryLast]
  )

  useHistoryShortcuts(generation)
  useContinueShortcut(generation)

  // The composer floats over the prose and autosizes; a fixed padding reservation
  // hides the newest lines — including the ones being streamed — as soon as the
  // draft grows past a few lines. Publish its real height instead.
  React.useEffect(() => {
    const box = composerBoxRef.current
    const shell = shellRef.current
    if (!box || !shell) return

    const sync = () =>
      shell.style.setProperty("--composer-h", `${box.offsetHeight}px`)
    sync()

    const observer = new ResizeObserver(sync)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  // Empty-state chips prime the composer; the writer still decides to send.
  // They are Do-shaped openings, so they arm Do too — priming "I look around"
  // while Say is still armed would send You say, "I look around."
  const handleSuggestion = React.useCallback(
    (text: string) => {
      changeMode("do")
      changeDraft(text)
      const textarea = composerRef.current
      if (!textarea) return
      textarea.focus()
      requestAnimationFrame(() => {
        const end = textarea.value.length
        textarea.setSelectionRange(end, end)
      })
    },
    [changeDraft, changeMode]
  )

  // The in-flight preview is held until the revalidated tree delivers the row,
  // so the finished picture does not blink out and back. This is the handover —
  // keyed on the ACTIVE take ids, not the count, because a retry lands as a
  // new active take in an old slot and leaves the count exactly where it was.
  // settle() itself only clears a job whose picture has landed, so the extra
  // firings on unrelated tree changes are no-ops.
  const imageIds = story.images.map((storyImage) => storyImage.id).join(",")
  const settleImage = image.settle
  React.useEffect(() => {
    settleImage()
  }, [imageIds, settleImage])

  /** Hands a picture's prompt back to the composer, armed to redraw it. */
  const handleEditImagePrompt = React.useCallback(
    (target: StoryImage) => {
      setAspectRatio(target.aspectRatio)
      restoreImagePrompt({
        prompt: target.prompt,
        sourcePrompt: target.sourcePrompt,
      })
      composerRef.current?.focus()
    },
    [restoreImagePrompt]
  )

  /**
   * The send. The style is folded in HERE and nowhere else, so the string the
   * provider gets and the string recorded as `prompt` are the same string by
   * construction — assisted or verbatim, it is one path.
   */
  const handleGenerateImage = React.useCallback(
    (send: {
      scene: string
      sourcePrompt: string | null
      loreIds: string[]
    }) => {
      // No publish of its own: the composer empties the brief and folds the
      // lane away in this same tick, and those changes publish the payload —
      // cleared exclusions and all. A publish here would only be the same
      // state announced twice.
      clearExcludedLore()
      void image.generate({
        prompt: composeSentPrompt(send.scene, imageStyleRef.current),
        sourcePrompt: send.sourcePrompt,
        promptLoreIds: send.loreIds,
        aspectRatio,
      })
    },
    [aspectRatio, clearExcludedLore, image]
  )

  return (
    <RetryProfilesProvider value={retryProfiles}>
      <div ref={shellRef} className="relative flex min-w-0 flex-1 flex-col">
        <StoryCanvas
          story={story}
          status={generation.status}
          busy={generation.busy}
          streamingText={generation.streamingText}
          optimisticUserText={generation.optimisticUserText}
          optimisticUserPending={generation.optimisticUserPending}
          removingEntryIds={generation.removingEntryIds}
          imageJob={image.job}
          onImageStop={image.stop}
          onImageRetry={(target, modelId) =>
            void image.generate({
              prompt: target.prompt,
              // Carried through rather than recomputed: a retry redraws THIS
              // take's prompt, so it was asked for by the same brief and told
              // the same lore, whatever the composer holds now.
              sourcePrompt: target.sourcePrompt,
              promptLoreIds: target.promptLoreIds,
              aspectRatio: target.aspectRatio,
              // Joins the slot, so this is another draw of the same beat rather
              // than a second picture appended to the end of the story.
              imageGroupId: target.imageGroupId,
              // The caret's pick, this take only; absent for a plain retry.
              modelId,
            })
          }
          onImageEditPrompt={handleEditImagePrompt}
          onRetry={handleRetry}
          onSuggestion={handleSuggestion}
        />
        <Composer
          value={draft}
          onValueChange={changeDraft}
          mode={mode}
          onModeChange={changeMode}
          aspectRatio={aspectRatio}
          onAspectRatioChange={setAspectRatio}
          imagePrompt={imagePrompt}
          onImagePromptChange={changeImagePrompt}
          imageAssisted={imageAssisted}
          onImageAssistedChange={changeImageAssisted}
          imageStyle={imageStyle}
          onImageStyleChange={changeImageStyle}
          loreMatches={loreMatches}
          includedLoreIds={includedLoreIds}
          excludedLoreIds={excludedLoreIds}
          onToggleLore={toggleLore}
          deriving={derivation.deriving}
          derivedBrief={derivation.derivedBrief}
          onDevelop={handleDevelop}
          onGenerateImage={handleGenerateImage}
          imageBusy={image.job !== null}
          textareaRef={composerRef}
          containerRef={composerBoxRef}
          status={generation.status}
          busy={generation.busy}
          canUndo={generation.canUndo}
          canRedo={generation.canRedo}
          canRetry={generation.canRetry}
          undoLabel={generation.undoLabel}
          redoLabel={generation.redoLabel}
          onSend={generation.send}
          onContinue={generation.continueStory}
          onRetry={handleRetry}
          onUndo={generation.undo}
          onRedo={generation.redo}
          onStop={generation.stop}
        />
      </div>
    </RetryProfilesProvider>
  )
}

/**
 * ⌘Z / ⌘⇧Z (Ctrl elsewhere) for the manuscript's own history.
 *
 * The guard is the important part, and matches the composer's Esc handler:
 * inside a text field ⌘Z stays the browser's own text undo. Reaching past a
 * half-typed sentence to reverse a whole turn is worse than no shortcut, and
 * the writer cannot get that sentence back.
 */
function useHistoryShortcuts(generation: GenerationController) {
  const { canUndo, canRedo, undo, redo } = generation

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "z" && event.key !== "Z") return
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return

      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement)
      ) {
        return
      }

      // Claimed either way once we are outside a text field, so the browser
      // does not also run a document-level undo behind the shortcut.
      event.preventDefault()
      if (event.shiftKey) {
        if (canRedo) redo()
      } else if (canUndo) {
        undo()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [canRedo, canUndo, redo, undo])
}

/**
 * ⌘↵ (Ctrl elsewhere) continues the story from anywhere in the workspace.
 *
 * The composer's tooltip has promised this combo all along, but the binding
 * lived in the textarea's own handler, so it went dead the moment focus
 * wandered to the canvas. This window-level copy honours the promise — and
 * only the promise: it fires solely where nothing closer has a claim.
 *
 * Text fields keep theirs: in the composer ⌘↵ sends a drafted move, in the
 * passage editor it saves the edit. Both are excluded here twice over — the
 * field guard below, and defaultPrevented, since each claims the combo with
 * preventDefault before it bubbles this far.
 *
 * Overlays keep theirs too. With a dialog, menu or the mobile inspector open,
 * the writer is somewhere else; continuing the story from behind a save-profile
 * dialog would spend a generation on a surface they cannot even see. Undo gets
 * away without this guard because it is reversible — continue is not free.
 */
function useContinueShortcut(generation: GenerationController) {
  const { busy, continueStory } = generation

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return
      if (event.key !== "Enter") return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey)
        return

      const target = event.target
      if (target instanceof HTMLElement) {
        if (
          target.isContentEditable ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target.closest('[role="dialog"], [role="menu"], [role="listbox"]')
        ) {
          return
        }
      }

      // Claimed even while busy: out here the combo means continue and nothing
      // else — letting it fall through to a focused button would activate that
      // button instead, turning "continue" into whatever was last clicked.
      event.preventDefault()
      if (!busy) continueStory()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [busy, continueStory])
}

/**
 * Focus mode: header, rail and inspector out of the way, manuscript alone.
 *
 * Deliberately not persisted — it is a posture for the next hour of writing,
 * and coming back to a chrome-less app days later reads as a broken layout.
 *
 * The rail is app-global state we are borrowing, so its pre-focus value is
 * saved and handed back on exit. ⌘B still works inside focus mode, which is
 * the escape hatch for "I need one thing from the library"; the saved value
 * wins on exit either way.
 *
 * The two sheets are dismissed rather than remembered: below lg they are the
 * rail and the inspector, and a sheet is somewhere the writer went, not a
 * layout to hand back.
 */
function useFocusMode(onEnter: () => void): [boolean, () => void] {
  const [focusMode, setFocusMode] = React.useState(false)
  const {
    open: sidebarOpen,
    setOpen: setSidebarOpen,
    setOpenMobile,
  } = useSidebar()
  const restoreSidebarRef = React.useRef(sidebarOpen)

  const toggle = React.useCallback(() => {
    if (focusMode) {
      setSidebarOpen(restoreSidebarRef.current)
    } else {
      restoreSidebarRef.current = sidebarOpen
      setSidebarOpen(false)
      setOpenMobile(false)
      onEnter()
    }
    setFocusMode(!focusMode)
  }, [focusMode, onEnter, setOpenMobile, sidebarOpen, setSidebarOpen])

  // Navigating away mid-focus (lorebook, settings) unmounts the workspace
  // before the exit branch can run, and setOpen(false) already reached the
  // sidebar cookie — restore here or the collapse persists as the writer's
  // own choice.
  const focusModeRef = React.useRef(focusMode)
  React.useEffect(() => {
    focusModeRef.current = focusMode
  }, [focusMode])
  React.useEffect(
    () => () => {
      if (focusModeRef.current) setSidebarOpen(restoreSidebarRef.current)
    },
    [setSidebarOpen]
  )

  return [focusMode, toggle]
}

/**
 * ⌘. (Ctrl elsewhere) toggles focus mode.
 *
 * No typing guard, unlike useHistoryShortcuts: the writer is in the composer
 * essentially always, and a modifier combo types nothing to reach past. ⌘B
 * has claimed the rail from inside the textarea since the beginning.
 */
function useFocusModeShortcut(toggle: () => void) {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      if (event.key !== ".") return
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return

      event.preventDefault()
      toggle()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [toggle])
}

/** Inspector visibility, remembered across stories and reloads. */
function useInspectorOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = React.useState(true)

  // Read after mount: the server has no localStorage, so seeding state from it
  // would desync hydration.
  useIsomorphicLayoutEffect(() => {
    if (window.localStorage.getItem(INSPECTOR_STORAGE_KEY) === "false") {
      setOpen(false)
    }
  }, [])

  const set = React.useCallback((next: boolean) => {
    setOpen(next)
    window.localStorage.setItem(INSPECTOR_STORAGE_KEY, String(next))
  }, [])

  return [open, set]
}

/**
 * Which inspector section is showing. A preference of the writer like the
 * panel's visibility, not a property of the story — reaching for memory on one
 * story and being dropped back on the model tab by opening another would make
 * the segments feel like they reset themselves.
 */
function useInspectorTab(): [InspectorTab, (tab: InspectorTab) => void] {
  const [tab, setTab] = React.useState<InspectorTab>("prompt")

  // Read after mount, for the same reason as useInspectorOpen: the server has
  // no localStorage, so seeding state from it would desync hydration.
  useIsomorphicLayoutEffect(() => {
    const saved = window.localStorage.getItem(INSPECTOR_TAB_STORAGE_KEY)
    if (saved === "prompt" || saved === "model" || saved === "lore") {
      setTab(saved)
    }
  }, [])

  const set = React.useCallback((next: InspectorTab) => {
    setTab(next)
    window.localStorage.setItem(INSPECTOR_TAB_STORAGE_KEY, next)
  }, [])

  return [tab, set]
}
