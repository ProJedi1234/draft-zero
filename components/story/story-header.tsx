"use client"

import * as React from "react"
import Link from "next/link"
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Loader2,
  Minimize2,
  NotebookText,
  PanelRight,
  Sparkles,
} from "lucide-react"

import type { Story, StoryCostProfile } from "@/lib/types"
import { formatWordCount } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useAtmosphereStatus } from "@/hooks/use-atmosphere-status"
import { useSaveStatus } from "@/hooks/use-autosave"
import { CostChip } from "@/components/cost/cost-chip"
import { StoryDetailsDialog } from "@/components/story/story-details-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/** Live save chip. Fixed width + identical icon size so states never shift the bar. */
function SaveStatusChip() {
  const status = useSaveStatus()

  return (
    <span
      aria-live="polite"
      className={cn(
        "hidden min-w-32 items-center justify-end gap-1.5 text-xs md:flex",
        status === "error" ? "text-destructive" : "text-muted-foreground"
      )}
    >
      {status === "saving" ? (
        <>
          <Loader2 className="size-3.5 animate-spin" />
          Saving…
        </>
      ) : status === "error" ? (
        <>
          <CircleAlert className="size-3.5" />
          Save failed
        </>
      ) : (
        <>
          <CircleCheck className="size-3.5" />
          Saved locally
        </>
      )}
    </span>
  )
}

/**
 * The atmosphere picker, when the inspector that normally shows it is shut.
 *
 * Beside the save chip because it is the same kind of fact — a background
 * write the writer did not ask for and should not have to wonder about — and
 * because that corner is already where this app puts them. It renders nothing
 * at rest: a permanent chip for a job that runs for two seconds after a turn
 * would be chrome claiming to be status.
 */
function AtmosphereChip({ storyId }: { storyId: string }) {
  const status = useAtmosphereStatus(storyId)
  const phase = status?.phase ?? null
  if (phase !== "checking" && phase !== "stopped") return null

  const stopped = phase === "stopped"
  const label = stopped ? "Atmosphere stopped" : "Reading the scene…"
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-live="polite"
            className={cn(
              "hidden items-center gap-1.5 text-xs md:flex",
              stopped ? "text-destructive" : "text-muted-foreground"
            )}
          />
        }
      >
        <span className="relative flex size-3.5 items-center justify-center">
          <Sparkles className="size-3.5" />
          {stopped ? null : (
            <span
              aria-hidden
              className="atmosphere-scan pointer-events-none absolute -inset-1 border border-foreground/60"
            />
          )}
        </span>
        {label}
      </TooltipTrigger>
      <TooltipContent>
        {stopped
          ? "The atmosphere picker gave up on this story. Change the model in Settings to start it again."
          : "Choosing the colour this story is read in."}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The wall-clock span of the generated manuscript, for the sparkline caption.
 * Derived here rather than queried: the entries are already on the client and
 * the ledger only needs the two endpoints.
 */
function useGeneratedSpan(story: Story) {
  return React.useMemo(() => {
    // The windowed read aggregates the span in SQL — the tail alone would
    // date the story from wherever the window happens to start. The scan
    // below survives as the fallback for stories built without the aggregate
    // (mock data, fixtures).
    if (story.generatedSpan !== undefined) return story.generatedSpan
    const dates = story.entries
      .filter((entry) => entry.source === "generated")
      .map((entry) => entry.createdAt)
    if (dates.length === 0) return null
    let firstIso = dates[0]
    let lastIso = dates[0]
    for (const iso of dates) {
      if (iso < firstIso) firstIso = iso
      if (iso > lastIso) lastIso = iso
    }
    return { firstIso, lastIso }
  }, [story.generatedSpan, story.entries])
}

/**
 * The rail toggle, plus a caret for the things that move the whole workspace
 * rather than the rail. The toggle itself is untouched — the caret is a second
 * button beside it, not a mode on the first.
 *
 * Focus mode is queued to the menu's close rather than run from the click: the
 * popup is portalled, so hiding the header out from under an open menu leaves
 * it floating over the manuscript with nothing to anchor to.
 */
function SidebarSplitTrigger({
  focusMode,
  onEnterFocusMode,
}: {
  focusMode: boolean
  onEnterFocusMode: () => void
}) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [focusQueued, setFocusQueued] = React.useState(false)

  // The same orphan, reached the other way: ⌘. while the menu is open hides the
  // header without ever closing the menu. Reset during the render that turns
  // focus mode on rather than in an effect, so the menu is never committed
  // open with its anchor already gone.
  const [focusModeWas, setFocusModeWas] = React.useState(focusMode)
  if (focusMode !== focusModeWas) {
    setFocusModeWas(focusMode)
    if (focusMode) {
      setMenuOpen(false)
      // ⌘. between the click and the close animation finishing would otherwise
      // leave the queue armed, and the callback is a toggle: it would land
      // after the fold and take focus mode straight back off.
      setFocusQueued(false)
    }
  }

  return (
    <span className="group/rail inline-flex items-center">
      <SidebarTrigger />
      <DropdownMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onOpenChangeComplete={(open) => {
          if (open || !focusQueued) return
          setFocusQueued(false)
          onEnterFocusMode()
        }}
      >
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-caret-sm"
              aria-label="Workspace options"
              // The hairline is the only thing saying these two buttons are
              // one control; it arrives with the hover fill they share.
              className="border-l border-transparent text-muted-foreground group-hover/rail:border-border"
            />
          }
        >
          <ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => setFocusQueued(true)}>
            <Minimize2 />
            Focus mode
            <DropdownMenuShortcut>⌘.</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}

export function StoryHeader({
  story,
  costProfile,
  inspectorOpen,
  onToggleInspector,
  onOpenMobileInspector,
  focusMode,
  onEnterFocusMode,
}: {
  story: Story
  costProfile: StoryCostProfile
  inspectorOpen: boolean
  onToggleInspector: () => void
  onOpenMobileInspector: () => void
  /** Folds the bar to nothing, and closes the portalled menu on the way. */
  focusMode: boolean
  onEnterFocusMode: () => void
}) {
  const inspectorLabel = inspectorOpen ? "Hide inspector" : "Show inspector"
  const span = useGeneratedSpan(story)
  const [detailsOpen, setDetailsOpen] = React.useState(false)

  return (
    <header
      // Mounted but folded: unmounting would drop the save chip's subscription
      // and the details dialog every time the writer takes a quiet hour.
      // `inert` is what keeps the folded row out of the tab order — clipped is
      // not hidden — and it also holds slice 4's assumption that the focus-mode
      // menu item cannot be reached from inside focus mode.
      inert={focusMode}
      className={cn(
        "flex shrink-0 items-center gap-2 overflow-hidden border-b px-4 transition-[height,opacity] duration-200 ease-linear",
        // globals.css's reduced-motion block only covers the run mark.
        "motion-reduce:transition-none",
        focusMode ? "h-0 opacity-0" : "h-14"
      )}
    >
      <SidebarSplitTrigger
        focusMode={focusMode}
        onEnterFocusMode={onEnterFocusMode}
      />
      {/* The title is the door to the story's library metadata — the fields
          used to be in the inspector, and clicking the thing you want to edit
          beats hunting for the field that edits it. The button sits INSIDE the
          h1: a heading is not phrasing content, so the other nesting is invalid
          and strips the landmark from the accessibility tree. */}
      <h1 className="min-w-0 truncate text-sm font-medium">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                className="max-w-full truncate rounded-sm text-left outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
              />
            }
          >
            {story.title}
          </TooltipTrigger>
          <TooltipContent>Edit story details</TooltipContent>
        </Tooltip>
      </h1>
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {formatWordCount(story.wordCount)}
      </span>
      <div className="flex-1" />
      {/* Only while the inspector is shut. Open, the sparkle in the atmosphere
          row is saying the same thing in the place the writer would look for
          it, and two indicators for one job is one too many. */}
      {inspectorOpen ? null : <AtmosphereChip storyId={story.id} />}
      <SaveStatusChip />
      <CostChip profile={costProfile} span={span} />
      <Tooltip>
        {/* The trigger renders the anchor directly. Wrapping it in <Button>
            instead would make Base UI's button expect native <button>
            semantics from an <a>, which it warns about. */}
        <TooltipTrigger
          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          aria-label="Open lorebook"
          // Prefetched because the route is now dataless: what comes back is
          // the shell, not the lorebook, so warming it costs a few KB and
          // removes the last round trip between the click and the entries —
          // which the store is already holding.
          render={<Link href={`/story/${story.id}/lorebook`} prefetch />}
        >
          <NotebookText className="size-4" />
        </TooltipTrigger>
        <TooltipContent>Lorebook</TooltipContent>
      </Tooltip>
      {/* Below lg the inspector lives in a sheet; at lg+ it's a toggleable side panel. */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open inspector"
              onClick={onOpenMobileInspector}
              className="lg:hidden"
            />
          }
        >
          <PanelRight className="size-4" />
        </TooltipTrigger>
        <TooltipContent>Open inspector</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={inspectorLabel}
              aria-pressed={inspectorOpen}
              onClick={onToggleInspector}
              className="hidden lg:inline-flex"
            />
          }
        >
          <PanelRight className="size-4" />
        </TooltipTrigger>
        <TooltipContent>{inspectorLabel}</TooltipContent>
      </Tooltip>
      <StoryDetailsDialog
        storyId={story.id}
        title={story.title}
        description={story.description}
        genre={story.genre}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </header>
  )
}
