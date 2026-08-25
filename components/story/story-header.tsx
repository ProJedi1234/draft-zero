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
} from "lucide-react"

import type { Story, StoryCostProfile } from "@/lib/types"
import { formatWordCount } from "@/lib/format"
import { cn } from "@/lib/utils"
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
    if (focusMode) setMenuOpen(false)
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
  className,
}: {
  story: Story
  costProfile: StoryCostProfile
  inspectorOpen: boolean
  onToggleInspector: () => void
  onOpenMobileInspector: () => void
  /** Only to close the portalled menu when the header goes away; the class below still does the hiding. */
  focusMode: boolean
  onEnterFocusMode: () => void
  className?: string
}) {
  const inspectorLabel = inspectorOpen ? "Hide inspector" : "Show inspector"
  const span = useGeneratedSpan(story)
  const [detailsOpen, setDetailsOpen] = React.useState(false)

  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center gap-2 border-b px-4",
        className
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
      <SaveStatusChip />
      <CostChip profile={costProfile} span={span} />
      <Tooltip>
        {/* The trigger renders the anchor directly. Wrapping it in <Button>
            instead would make Base UI's button expect native <button>
            semantics from an <a>, which it warns about. */}
        <TooltipTrigger
          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          aria-label="Open lorebook"
          render={<Link href={`/story/${story.id}/lorebook`} />}
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
