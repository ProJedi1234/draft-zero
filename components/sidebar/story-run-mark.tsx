"use client"

// components/sidebar/story-run-mark.tsx — What a story row says about its run.
//
// Four states, all of them living in the 20px slot the row's kebab occupies on
// hover:
//
//   working   three squares, hopping: this story is generating right now
//   done      one filled dot: a passage landed while you were somewhere else
//   failed    one hollow ring: the run stopped and produced nothing
//   idle      nothing at all, which is almost every row almost always
//
// The dots are the manuscript's own GenerationCaret, so a writer who has
// watched one passage generate already knows what a hopping row means. There
// is deliberately no `pending` here even though the caret has one: the sidebar
// is not attached to the run's stream and genuinely cannot tell "requested"
// from "writing", and a mark that guesses is worse than one that doesn't.
//
// The marks are aria-hidden. Status reaches a screen reader as words, through
// the row's own subtitle ("writing · 1m 14s", "new passage"), because six
// pixels of shape is not a thing to announce.

import * as React from "react"

import { cn } from "@/lib/utils"

export type RunMarkState = "idle" | "working" | "done" | "failed"

/** Must match the CSS in globals.css — the swap happens when the last frame lands. */
const ENDING_MS = { land: 300, fail: 240 } as const

type Ending = keyof typeof ENDING_MS

/**
 * Why this component has state at all, when its row is a pure function of the
 * server's answer: the ending animation has to outlive the fact that caused
 * it. The sidebar repaints because a `change` event triggered router.refresh(),
 * and by the time React re-renders, the story is simply *done* — the run it was
 * doing is gone from the props. So the mark remembers it was working a moment
 * ago and keeps rendering the dots until the transition finishes.
 */
export function StoryRunMark({
  state,
  className,
}: {
  state: RunMarkState
  className?: string
}) {
  const [ending, setEnding] = React.useState<Ending | null>(null)
  // What this mark was last rendered against. Compared during render rather
  // than in an effect, the way useServerSyncedValue reconciles: an effect
  // would set state a frame late, and the dots would already have been
  // replaced by the settled mark before the transition could start.
  const [seen, setSeen] = React.useState(state)

  if (seen !== state) {
    setSeen(state)
    // Only a run that was visibly working gets a transition. Anything else —
    // a mark spent by opening the story, a row that arrives already finished
    // from a fresh page load — has nothing to animate away from, and clearing
    // to null also cancels an ending the writer navigated out from under.
    setEnding(
      seen === "working"
        ? state === "done"
          ? "land"
          : state === "failed"
            ? "fail"
            : null
        : null
    )
  }

  React.useEffect(() => {
    if (ending === null) return
    const timer = setTimeout(() => setEnding(null), ENDING_MS[ending])
    return () => clearTimeout(timer)
  }, [ending])

  if (ending !== null) return <Dots className={className} end={ending} />
  if (state === "working") return <Dots className={className} hop />
  if (state === "done")
    return <span aria-hidden className={cn("run-mark-done", className)} />
  if (state === "failed")
    return <span aria-hidden className={cn("run-mark-failed", className)} />
  return null
}

function Dots({
  hop = false,
  end,
  className,
}: {
  hop?: boolean
  end?: Ending
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn("run-mark", className)}
      // Absent rather than "false" while ending: the hop rule must stop
      // applying entirely, or its infinite animation outranks the transition
      // that is supposed to bring a mid-air dot back down.
      data-hop={hop ? "true" : undefined}
      data-end={end}
    >
      <i />
      <i />
      <i />
    </span>
  )
}
