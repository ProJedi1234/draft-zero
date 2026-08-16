"use client"

import * as React from "react"

import type {
  ActionKind,
  LorebookEntry,
  ModelProfile,
  OpenRouterModel,
  Story,
  StoryCostProfile,
} from "@/lib/types"
import { runHandoff } from "@/lib/sync/client"
import { cn } from "@/lib/utils"
import {
  useGeneration,
  type GenerationController,
} from "@/hooks/use-generation"
import {
  InspectorContent,
  InspectorPanel,
} from "@/components/inspector/inspector-panel"
import { Composer } from "@/components/story/composer"
import { StoryCanvas } from "@/components/story/story-canvas"
import { StoryHeader } from "@/components/story/story-header"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

/** Workspace preferences are the writer's, not the story's — they survive reloads. */
const INSPECTOR_STORAGE_KEY = "draft-zero:inspector-open"
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
  costProfile,
  profiles,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
  models: OpenRouterModel[]
  /** Server-read spend for this story — the header chip's ledger. */
  costProfile: StoryCostProfile
  /** Every profile, in the writer's order — the inspector's switcher list. */
  profiles: ModelProfile[]
}) {
  const [inspectorOpen, setInspectorOpen] = useInspectorOpen()
  const [mobileInspectorOpen, setMobileInspectorOpen] = React.useState(false)
  const [actionKind, setActionKind] = React.useState<ActionKind>("do")

  // The sync channel itself lives in the root layout (components/
  // sync-listener.tsx) so the library and settings pages hear `change` too;
  // this workspace only registers as the run-started target while mounted.
  // The ref bridges to the keyed editor below: the generation hook writes its
  // attach function into it, and a `run-started` from another device calls
  // through — which is the entire multi-device story; there is deliberately
  // nothing to see.
  const attachRef = React.useRef<((runId: string | null) => void) | null>(null)
  React.useEffect(() => {
    runHandoff.current = {
      storyId: story.id,
      onRunStarted: (runId) => attachRef.current?.(runId),
      // A reconnect means run-started events may have been missed while the
      // socket was down; a null attach is the "is anything running?" probe.
      onReconnect: () => attachRef.current?.(null),
    }
    return () => {
      runHandoff.current = null
    }
  }, [story.id])

  return (
    <div className="flex h-app min-w-0 flex-col">
      <StoryHeader
        story={story}
        costProfile={costProfile}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen(!inspectorOpen)}
        onOpenMobileInspector={() => setMobileInspectorOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        {/* Keyed here, not on the workspace: generation state and the
            uncontrolled-after-mount fields (§4.2) must reset per story. */}
        <StoryEditor
          key={story.id}
          story={story}
          actionKind={actionKind}
          onActionKindChange={setActionKind}
          attachRef={attachRef}
        />
        <InspectorPanel
          story={story}
          lorebookEntries={lorebookEntries}
          models={models}
          profiles={profiles}
          className={cn("hidden", inspectorOpen && "lg:flex")}
        />
      </div>

      <Sheet open={mobileInspectorOpen} onOpenChange={setMobileInspectorOpen}>
        <SheetContent
          side="right"
          className="w-80 gap-0 pt-[env(safe-area-inset-top)] lg:hidden"
        >
          <SheetHeader className="border-b p-4">
            <SheetTitle className="text-sm">Inspector</SheetTitle>
          </SheetHeader>
          <InspectorContent
            story={story}
            lorebookEntries={lorebookEntries}
            models={models}
            profiles={profiles}
          />
        </SheetContent>
      </Sheet>
    </div>
  )
}

/** Canvas + composer + generation: the part that is per-story. */
function StoryEditor({
  story,
  actionKind,
  onActionKindChange,
  attachRef,
}: {
  story: Story
  actionKind: ActionKind
  onActionKindChange: (kind: ActionKind) => void
  /** Bridge from the workspace's sync channel: run-started → attach mid-flight; null = re-probe. */
  attachRef: { current: ((runId: string | null) => void) | null }
}) {
  const [draft, setDraft] = React.useState("")
  const composerRef = React.useRef<HTMLTextAreaElement>(null)
  const composerBoxRef = React.useRef<HTMLDivElement>(null)
  const shellRef = React.useRef<HTMLDivElement>(null)

  const generation = useGeneration(story, {
    // The composer clears the moment a move dispatches, so until the server has
    // written the row the textarea is the only copy of what the writer typed.
    onRestoreDraft: setDraft,
    attachRef,
  })

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
      onActionKindChange("do")
      setDraft(text)
      const textarea = composerRef.current
      if (!textarea) return
      textarea.focus()
      requestAnimationFrame(() => {
        const end = textarea.value.length
        textarea.setSelectionRange(end, end)
      })
    },
    [onActionKindChange]
  )

  return (
    <div ref={shellRef} className="relative flex min-w-0 flex-1 flex-col">
      <StoryCanvas
        story={story}
        status={generation.status}
        busy={generation.busy}
        streamingText={generation.streamingText}
        optimisticUserText={generation.optimisticUserText}
        optimisticUserPending={generation.optimisticUserPending}
        removingEntryIds={generation.removingEntryIds}
        onRetry={generation.retryLast}
        onSuggestion={handleSuggestion}
      />
      <Composer
        value={draft}
        onValueChange={setDraft}
        actionKind={actionKind}
        onActionKindChange={onActionKindChange}
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
        onRetry={generation.retryLast}
        onUndo={generation.undo}
        onRedo={generation.redo}
        onStop={generation.stop}
      />
    </div>
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
