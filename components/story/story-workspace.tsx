"use client"

import * as React from "react"

import type {
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
/** Unsent composer text, per story, for the length of the browser session. */
const DRAFT_STORAGE_PREFIX = "draft-zero:draft:"

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect

/**
 * The workspace shell. Everything here is deliberately OUTSIDE the story-keyed
 * subtree: inspector visibility and the armed Say/Do move are preferences of the
 * writer, not properties of the story, and remounting them on every navigation
 * would slam the inspector back open and silently drop the writer back to Do.
 */
export function StoryWorkspace({
  story,
  lorebookEntries,
  models,
  imageModels,
  imageModelPrice,
  costProfile,
  profiles,
  defaultProfileId,
  requireZdr,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
  models: OpenRouterModel[]
  /** The image catalog — a separate endpoint and a separate shape; see lib/images/models.ts. */
  imageModels: OpenRouterImageModel[]
  /** What the story's selected image model costs per image, or null when unknown. */
  imageModelPrice: string | null
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
  // Owned here so switching stories does not reset which mode is armed.
  const [mode, setMode] = React.useState<ComposerMode>("do")
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
  React.useEffect(() => {
    runHandoff.current = {
      storyId: story.id,
      onRunStarted: (runId) => attachRef.current?.(runId),
      onImageRunStarted: (runId) => imageAttachRef.current?.(runId),
      // A reconnect means run-started events may have been missed while the
      // socket was down; a null attach is the "is anything running?" probe —
      // one per channel.
      onReconnect: () => {
        attachRef.current?.(null)
        imageAttachRef.current?.(null)
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
        <StoryEditor
          key={story.id}
          story={story}
          models={models}
          profiles={profiles}
          defaultProfileId={defaultProfileId}
          mode={mode}
          onModeChange={setMode}
          attachRef={attachRef}
          imageAttachRef={imageAttachRef}
        />
        <InspectorPanel
          story={story}
          lorebookEntries={lorebookEntries}
          models={models}
          imageModels={imageModels}
          imageModelPrice={imageModelPrice}
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
  models,
  profiles,
  defaultProfileId,
  mode,
  onModeChange,
  attachRef,
  imageAttachRef,
}: {
  story: Story
  /** For the retry menu's one-line summary of each profile. */
  models: OpenRouterModel[]
  profiles: ModelProfile[]
  defaultProfileId: string | null
  mode: ComposerMode
  onModeChange: (mode: ComposerMode) => void
  /** Bridge from the workspace's sync channel: run-started → attach mid-flight; null = re-probe. */
  attachRef: { current: ((runId: string | null) => void) | null }
  /** Same bridge for the image channel — image-run-started lands here. */
  imageAttachRef: { current: ((runId: string | null) => void) | null }
}) {
  const [draft, setDraft] = React.useState("")
  const composerRef = React.useRef<HTMLTextAreaElement>(null)
  const composerBoxRef = React.useRef<HTMLDivElement>(null)
  const shellRef = React.useRef<HTMLDivElement>(null)

  const image = useImageGeneration(story.id, {
    onRestoreDraft: (prompt) => {
      // Only into an EMPTY composer. A failed retry (fired from the picture's
      // own cluster, not from here) must not overwrite a sentence the writer is
      // halfway through typing — losing live keystrokes to a background failure
      // is a worse trade than losing a prompt they can regenerate.
      setDraft((current) => (current === "" ? prompt : current))
      // Armed for image, because the restored text IS an image prompt: handing
      // it back under Do would leave the next Send about to file a scene
      // description as the writer's turn.
      onModeChange("image")
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

  const derivation = useImagePromptDerivation(story.id)
  // Remembered across sends, like the armed mode: a writer working in portrait
  // is working in portrait until they say otherwise.
  const [aspectRatio, setAspectRatio] = React.useState<ImageAspectRatio>("16:9")

  const generation = useGeneration(story, {
    // The composer clears the moment a move dispatches, so until the server has
    // written the row the textarea is the only copy of what the writer typed.
    onRestoreDraft: setDraft,
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

  useDraftPersistence(story.id, draft, setDraft)

  useHistoryShortcuts(generation)

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
      onModeChange("do")
      setDraft(text)
      const textarea = composerRef.current
      if (!textarea) return
      textarea.focus()
      requestAnimationFrame(() => {
        const end = textarea.value.length
        textarea.setSelectionRange(end, end)
      })
    },
    [onModeChange]
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
      onModeChange("image")
      setAspectRatio(target.aspectRatio)
      setDraft(target.prompt)
      composerRef.current?.focus()
    },
    [onModeChange]
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
          onImageRetry={(target) =>
            void image.generate({
              prompt: target.prompt,
              aspectRatio: target.aspectRatio,
              // Joins the slot, so this is another draw of the same beat rather
              // than a second picture appended to the end of the story.
              imageGroupId: target.imageGroupId,
            })
          }
          onImageEditPrompt={handleEditImagePrompt}
          onRetry={handleRetry}
          onSuggestion={handleSuggestion}
        />
        <Composer
          value={draft}
          onValueChange={setDraft}
          mode={mode}
          onModeChange={onModeChange}
          aspectRatio={aspectRatio}
          onAspectRatioChange={setAspectRatio}
          deriving={derivation.deriving}
          onDerive={() => void derivation.derive(setDraft)}
          onGenerateImage={(prompt) =>
            void image.generate({ prompt, aspectRatio })
          }
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

/**
 * Keeps a typed-but-unsent draft alive across navigation. Every other piece of
 * writing in the app is persisted; the composer was the one place prose could
 * vanish by clicking "Lorebook".
 */
function useDraftPersistence(
  storyId: string,
  draft: string,
  setDraft: (value: string) => void
) {
  const storageKey = DRAFT_STORAGE_PREFIX + storyId
  const restoredRef = React.useRef(false)

  useIsomorphicLayoutEffect(() => {
    const saved = window.sessionStorage.getItem(storageKey)
    if (saved) setDraft(saved)
    restoredRef.current = true
  }, [storageKey, setDraft])

  React.useEffect(() => {
    // Never write before the restore pass, or the initial "" would erase it.
    if (!restoredRef.current) return
    if (draft === "") window.sessionStorage.removeItem(storageKey)
    else window.sessionStorage.setItem(storageKey, draft)
  }, [draft, storageKey])
}
