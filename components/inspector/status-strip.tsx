"use client"

import * as React from "react"

import { ContextDialog } from "@/components/context/context-dialog"
import { Meter } from "@/components/ui/meter"
import { describeContext } from "@/lib/generation/breakdown"
import { composeContext } from "@/lib/generation/context"
import { settingsSummaryParts } from "@/lib/settings-summary"
import {
  contextWindowLabel,
  type GenerationIdentity,
  type LorebookEntry,
  type OpenRouterModel,
  type Story,
} from "@/lib/types"

/**
 * The two facts you want regardless of what else the inspector is showing:
 * which model is about to run, and how full its window already is.
 *
 * Both are readouts rather than controls, so they belong in chrome instead of
 * in the scroll — the story header already carries save status and cost the
 * same way. Pinning them also fixes an ordering bug: the meter used to sit
 * ABOVE memory and the author's note, scrolling out of view exactly as the
 * writer began changing the numbers it was counting. Here it stays on screen
 * while they type.
 */
export function StatusStrip({
  story,
  lorebookEntries,
  contextWindow,
  models,
  identity,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
  /** Selected, model-clamped input budget in tokens. Always a ladder stop. */
  contextWindow: number
  models: OpenRouterModel[]
  /**
   * The model identity as the CONTROLS have it, not `story.settings` — in
   * Custom mode the picker is ahead of the row for the length of a save, and a
   * strip reading the story would spend that time contradicting the combobox
   * two inches above it.
   */
  identity: GenerationIdentity
}) {
  const parts = settingsSummaryParts(identity, models)

  return (
    // The safe-area pad moved here from the scroll body: this is the app's
    // bottom edge now, and the scroll no longer reaches it.
    <div className="shrink-0 space-y-1.5 border-t bg-muted/40 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium">{parts.model}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {parts.provider} · {parts.thinking}
        </span>
      </div>
      <ContextMeter
        story={story}
        lorebookEntries={lorebookEntries}
        contextWindow={contextWindow}
      />
    </div>
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
