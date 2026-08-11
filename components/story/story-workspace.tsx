"use client"

import * as React from "react"

import type { LorebookEntry, Story } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useGeneration, type ComposerMode } from "@/hooks/use-generation"
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
 * subtree: inspector visibility and composer mode are preferences of the writer,
 * not properties of the story, and remounting them on every navigation would
 * slam the inspector back open and silently flip Instruction mode back to Story.
 */
export function StoryWorkspace({
  story,
  lorebookEntries,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
}) {
  const [inspectorOpen, setInspectorOpen] = useInspectorOpen()
  const [mobileInspectorOpen, setMobileInspectorOpen] = React.useState(false)
  const [mode, setMode] = React.useState<ComposerMode>("story")

  return (
    <div className="flex h-app min-w-0 flex-col">
      <StoryHeader
        story={story}
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
          mode={mode}
          onModeChange={setMode}
        />
        <InspectorPanel
          story={story}
          lorebookEntries={lorebookEntries}
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
          <InspectorContent story={story} lorebookEntries={lorebookEntries} />
        </SheetContent>
      </Sheet>
    </div>
  )
}

/** Canvas + composer + generation: the part that is per-story. */
function StoryEditor({
  story,
  mode,
  onModeChange,
}: {
  story: Story
  mode: ComposerMode
  onModeChange: (mode: ComposerMode) => void
}) {
  const [draft, setDraft] = React.useState("")
  const composerRef = React.useRef<HTMLTextAreaElement>(null)
  const composerBoxRef = React.useRef<HTMLDivElement>(null)
  const shellRef = React.useRef<HTMLDivElement>(null)

  const generation = useGeneration(story, {
    // Instruction-mode text is never persisted, so a failed dispatch would
    // otherwise destroy it — the composer is its only home.
    onRestoreDraft: setDraft,
  })

  useDraftPersistence(story.id, draft, setDraft)

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
  const handleSuggestion = React.useCallback((text: string) => {
    setDraft(text)
    const textarea = composerRef.current
    if (!textarea) return
    textarea.focus()
    requestAnimationFrame(() => {
      const end = textarea.value.length
      textarea.setSelectionRange(end, end)
    })
  }, [])

  return (
    <div ref={shellRef} className="relative flex min-w-0 flex-1 flex-col">
      <StoryCanvas
        story={story}
        status={generation.status}
        busy={generation.busy}
        streamingText={generation.streamingText}
        optimisticUserText={generation.optimisticUserText}
        removingEntryIds={generation.removingEntryIds}
        onRetryFrom={generation.retryFrom}
        onSuggestion={handleSuggestion}
      />
      <Composer
        value={draft}
        onValueChange={setDraft}
        mode={mode}
        onModeChange={onModeChange}
        textareaRef={composerRef}
        containerRef={composerBoxRef}
        status={generation.status}
        busy={generation.busy}
        canUndo={generation.canUndo}
        canRetry={generation.canRetry}
        onSend={generation.send}
        onContinue={generation.continueStory}
        onRetry={generation.retryLast}
        onUndo={generation.undo}
        onStop={generation.stop}
      />
    </div>
  )
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
