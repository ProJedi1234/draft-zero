"use client"

import * as React from "react"
import { ScanSearch } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { loadEntryContext, type EntryContext } from "@/lib/actions/context"
import { describeContext } from "@/lib/generation/breakdown"
import { shortModelId } from "@/lib/format"

import { ContextDialog } from "./context-dialog"

const LABEL = "View context"
/**
 * Present tense, and deliberately not "context used for this action": this is
 * composed from the story as it stands, so claiming it is what went out would
 * be a claim the app cannot back. See loadEntryContext.
 */
const CAPTION = "Context for this passage"
const GONE = "This passage is no longer in the manuscript."
/** Only for a thrown request — the action words its own failures. */
const FALLBACK_ERROR = "Couldn't work out the context for this passage."

type State =
  | { status: "idle" | "loading" }
  | { status: "loaded"; entry: EntryContext | null }
  | { status: "failed"; error: string }

/**
 * The per-passage entry point: what this passage is shown, composed from the
 * manuscript up to it.
 *
 * Re-fetched on every open rather than cached: the answer moves whenever the
 * lorebook, memory or window does, and a re-render is not a remount — holding
 * the first answer would leave a stale breakdown on screen under a note that
 * promises it reflects the settings as they stand now.
 */
export function EntryContextButton({
  storyId,
  entryId,
}: {
  storyId: string
  entryId: string
}) {
  const [open, setOpen] = React.useState(false)
  const [state, setState] = React.useState<State>({ status: "idle" })

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next || state.status === "loading") return
    setState({ status: "loading" })
    void loadEntryContext(storyId, entryId)
      .then((result) => {
        setState(
          result.ok
            ? { status: "loaded", entry: result.data }
            : { status: "failed", error: result.error }
        )
      })
      .catch(() => setState({ status: "failed", error: FALLBACK_ERROR }))
  }

  const entry = state.status === "loaded" ? state.entry : null
  // Only what is on screen: this holds the whole prompt, and rebuilding it on
  // every re-render of a block whose dialog is shut is work nobody asked for.
  const breakdown = React.useMemo(
    () =>
      open && entry
        ? describeContext(entry.context, entry.contextWindow)
        : null,
    [open, entry]
  )

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={LABEL}
              onClick={() => handleOpenChange(true)}
            />
          }
        >
          <ScanSearch />
        </TooltipTrigger>
        <TooltipContent>{LABEL}</TooltipContent>
      </Tooltip>
      <ContextDialog
        open={open}
        onOpenChange={handleOpenChange}
        caption={CAPTION}
        // Omitted rather than filled in with today's model when the row never
        // recorded one: an invented provenance reads exactly like a real one.
        meta={entry?.modelId ? shortModelId(entry.modelId) : undefined}
        // The one caveat that changes how this should be read, said once,
        // where it is read — not buried in a tooltip.
        note="Composed from the manuscript up to this passage, against the lorebook and settings as they stand now — the same way a retry of it would be."
        breakdown={breakdown}
        loading={state.status === "loading"}
        emptyMessage={state.status === "failed" ? state.error : GONE}
      />
    </>
  )
}
