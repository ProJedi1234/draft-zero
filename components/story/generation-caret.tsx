"use client"

// components/story/generation-caret.tsx — The mark at the live edge of the
// manuscript, in each of its states.
//
// This slot used to be a plain blinking bar throughout, which meant it said the
// same thing whether the model was reasoning hard or the request had quietly
// stalled. It is now the app's generation indicator:
//
//   pending    three dots, dim and still: the request is out, no news yet
//   thinking   the dots hop, and elapsed time appears: the model is reasoning
//   streaming  the bar, solid and still, riding the end of the prose
//   settling   nothing: the passage is final and waiting on its row
//
// The dots collapsing into the bar IS the handoff — the thinking became a word.
// Bar-only alternatives (a breathing caret) and pictorial ones (a pixel quill)
// both needed explaining first; three cycling dots do not.
//
// Geometry note, all of it load-bearing. This is an EMPTY inline-block with an
// explicit width and height, because that is the one case where the CSS baseline
// is defined as the bottom margin edge — which is what puts the mark on the text
// line. The states inside are absolutely positioned off `bottom: 0`, so each
// one's foot lands where the bar's foot lands. And the box's width is STATED per
// state rather than inferred, because absolutely-positioned children contribute
// none: without it the box collapses to zero and the elapsed readout renders on
// top of the dots.

import * as React from "react"

import { cn } from "@/lib/utils"
import type { GenerationStatus } from "@/hooks/use-generation"

/** The dots cluster: three 3px dots with 2px gaps. */
const DOTS_WIDTH = "13px"
/** The bar — the same `w-0.5` this caret has always been. */
const BAR_WIDTH = "2px"

/**
 * Whole seconds since the model started reasoning. Owned here rather than in
 * useGeneration deliberately: a clock in the hook would re-render the whole
 * canvas — every persisted passage included — once a second for the length of a
 * think, to update one word of text.
 */
function useElapsedSeconds(running: boolean): number {
  const [seconds, setSeconds] = React.useState(0)

  React.useEffect(() => {
    if (!running) return
    const startedAt = Date.now()
    // Re-reads the clock instead of incrementing a counter: a backgrounded tab
    // throttles timers, and a counter would come back visibly behind the wall
    // clock the writer actually waited through.
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000
    )
    return () => {
      clearInterval(timer)
      setSeconds(0)
    }
  }, [running])

  return running ? seconds : 0
}

export function GenerationCaret({ status }: { status: GenerationStatus }) {
  const thinking = status === "thinking"
  const waiting = status === "pending" || thinking
  const seconds = useElapsedSeconds(thinking)

  return (
    <>
      <span
        aria-hidden
        data-state={status}
        className="relative ml-0.5 inline-block h-[1.05em] translate-y-[0.15em] align-baseline transition-[width] duration-150"
        style={{ width: waiting ? DOTS_WIDTH : BAR_WIDTH }}
      >
        {/* Both states stay mounted, so the collapse is a crossfade across a
            width transition rather than one element popping out and another in. */}
        <span
          className={cn(
            "absolute bottom-0 left-0 flex items-end gap-0.5 transition-opacity duration-150",
            waiting ? "opacity-100" : "opacity-0"
          )}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={cn(
                "size-[3px] bg-primary/60",
                // Only `thinking` animates. While pending there is genuinely no
                // news, and hopping dots would be claiming otherwise. Pending is
                // also dimmed: the hop cycles between .3 and 1 opacity, so
                // leaving these at full would make "no news yet" the brightest
                // thing on the line. Under reduced motion the two states differ
                // by this dimming and the elapsed readout alone, which is the
                // right trade — a static mark that is legible beats a moving one
                // that was asked not to move.
                thinking ? "motion-safe:animate-dot-hop" : "opacity-40"
              )}
              style={thinking ? { animationDelay: `${i * 160}ms` } : undefined}
            />
          ))}
        </span>

        <span
          className={cn(
            "absolute bottom-0 left-0 h-[1.05em] w-0.5 bg-primary/60 transition-opacity duration-150",
            status === "streaming" ? "opacity-100" : "opacity-0"
          )}
        />
      </span>

      {/* Elapsed time is the only honest number while thinking: no prose exists
          to count, and the exact token figures do not arrive until the stream's
          final event. It shares the empty line with the dots and is gone the
          moment prose needs that line. */}
      {thinking && (
        <span
          aria-hidden
          className="ml-2 align-baseline font-mono text-[11px] text-muted-foreground tabular-nums"
        >
          thinking {seconds}s
        </span>
      )}
    </>
  )
}
