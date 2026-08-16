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
const FAILED = "Couldn't work out the context for this passage."

type State =
  | { status: "idle" | "loading" }
  | { status: "loaded"; entry: EntryContext | null }
  | { status: "failed" }

/**
 * The per-passage entry point: what this passage is shown, composed from the
 * manuscript up to it.
 *
 * Fetched on open and then held for as long as the block is mounted. The
 * answer can go stale — editing lore moves it — but a writer who edits the
 * lorebook gets a re-render from the revalidated tree anyway, and re-composing
 * a whole story tree on every re-open of a dialog nobody changed is worse. A
 * failure is NOT held, so the next open retries.
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
    if (!next || state.status === "loading" || state.status === "loaded") return
    setState({ status: "loading" })
    void loadEntryContext(storyId, entryId)
      .then((result) => {
        setState(
          result.ok
            ? { status: "loaded", entry: result.data }
            : { status: "failed" }
        )
      })
      .catch(() => setState({ status: "failed" }))
  }

  const entry = state.status === "loaded" ? state.entry : null
  const breakdown = entry
    ? describeContext(entry.context, entry.contextWindow)
    : null

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
        meta={entry ? shortModelId(entry.modelId) : undefined}
        // The one caveat that changes how this should be read, said once,
        // where it is read — not buried in a tooltip.
        note="Composed from the manuscript up to this passage, against the lorebook and settings as they stand now — the same way a retry of it would be."
        breakdown={breakdown}
        loading={state.status === "loading"}
        emptyMessage={state.status === "failed" ? FAILED : GONE}
      />
    </>
  )
}
