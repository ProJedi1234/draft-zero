"use client"

import * as React from "react"

import type { Story } from "@/lib/types"
import { cn } from "@/lib/utils"
import { formatDateShort } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { CanvasEmptyState } from "@/components/story/canvas-empty-state"
import { Prose } from "@/components/story/prose"
import { StoryEntryBlock } from "@/components/story/story-entry-block"
import { StreamingBlock } from "@/components/story/streaming-block"
import type { GenerationStatus } from "@/hooks/use-generation"

/** How close to the bottom the reader must be for streaming to keep scrolling. */
const STICK_THRESHOLD_PX = 120

// Landing at the live edge must happen before the browser paints, otherwise the
// canvas flashes the top of the manuscript on every story open.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect

export function StoryCanvas({
  story,
  status,
  busy,
  streamingText,
  optimisticUserText,
  optimisticUserPending,
  removingEntryIds,
  onRetry,
  onSuggestion,
}: {
  story: Story
  status: GenerationStatus
  busy: boolean
  streamingText: string
  optimisticUserText: string | null
  optimisticUserPending: boolean
  removingEntryIds: string[]
  /** Regenerates the last passage. It takes no id: nothing else is retryable. */
  onRetry: () => void
  onSuggestion: (text: string) => void
}) {
  const contentRef = React.useRef<HTMLDivElement>(null)
  // Sticky by default; flipped off the moment the reader scrolls away.
  const stickToBottomRef = React.useRef(true)

  // Live means the provider still owns the passage. `settling` is neither live
  // nor idle: the prose is finished and rendered from the local buffer while its
  // row is in flight, so the block stays but the caret and the Stop affordance
  // go — and the hook empties the buffer in the commit that delivers the row.
  const live =
    status === "pending" || status === "thinking" || status === "streaming"
  const showTail = live || streamingText !== ""
  const removing = new Set(removingEntryIds)
  const entries = story.entries.filter((entry) => !removing.has(entry.id))
  const hasContent =
    entries.length > 0 || optimisticUserText !== null || showTail

  const getViewport = React.useCallback(
    () =>
      contentRef.current?.closest<HTMLElement>(
        '[data-slot="scroll-area-viewport"]'
      ) ?? null,
    []
  )

  // Open at the end of the prose — where the writer actually is — and only ever
  // let a real scroll gesture flip the sticky flag. Seeding the flag from the
  // initial scroll position instead would read `scrollTop === 0` and turn
  // auto-follow off before the first generation on any story taller than the
  // viewport.
  useIsomorphicLayoutEffect(() => {
    const viewport = getViewport()
    if (!viewport) return

    const content = contentRef.current
    if (!content) return

    stickToBottomRef.current = true
    let mounted = true
    let frame: number | null = null

    const pinNow = () => {
      frame = null
      if (!mounted || !stickToBottomRef.current) return
      const target = viewport.scrollHeight - viewport.clientHeight
      // A sub-pixel correction is not worth a scroll event, and writing
      // scrollTop unconditionally on every chunk is what made following the
      // prose feel like a series of yanks rather than a drift.
      if (target - viewport.scrollTop < 1) return
      viewport.scrollTop = target
    }

    // Coalesced to one write per frame. Growth arrives in ~24 ms chunks, so
    // without this a single frame can take several scrollTop writes, each one
    // re-entering layout and re-firing the observers that scheduled it.
    const pin = () => {
      if (!mounted || !stickToBottomRef.current || frame !== null) return
      frame = requestAnimationFrame(pinNow)
    }

    // The very first landing is synchronous: deferring it to a frame would let
    // the browser paint the top of the manuscript first.
    pinNow()

    // The landing height is wrong for longer than a frame: web fonts swap in
    // over the fallback metrics, and --composer-h (the canvas' bottom padding)
    // is published by the workspace's own ResizeObserver. Both grow the
    // document *after* the pin, leaving scrollTop stranded near the top — so
    // re-pin on every height change instead of guessing when it settles.
    //
    // This is also what follows the stream: the prose growing is a resize, so
    // the scroll tracks the DOM directly rather than riding a React effect keyed
    // on the chunk text. Same result, one commit's worth of latency earlier, and
    // it keeps working for growth React didn't cause (a font swap, the composer
    // autosizing under a long draft).
    const observer = new ResizeObserver(pin)
    observer.observe(content)
    observer.observe(viewport)

    // ResizeObserver never fires for a same-size reflow, which is exactly what
    // a metrics-compatible font swap is.
    document.fonts?.ready.then(pin)

    const onScroll = () => {
      const distance =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      stickToBottomRef.current = distance <= STICK_THRESHOLD_PX
    }

    // Reading back up mid-generation has to win on the first notch, not on the
    // 120th pixel. Waiting for the scroll event to clear the threshold means
    // competing with prose that is still growing underneath — the reader
    // scrolls, the next chunk lands, the pin fires before they have travelled
    // far enough to count, and the canvas snaps back. An upward gesture is
    // unambiguous, so take it at face value and stop following immediately;
    // scrolling back down re-arms sticky through onScroll as before.
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) stickToBottomRef.current = false
    }

    // The touch equivalent: a finger travelling *down* the screen pulls earlier
    // prose into view. Keyed on movement rather than touchstart, so tapping a
    // passage's action buttons doesn't count as walking away.
    let touchStartY = 0
    const onTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? 0
    }
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY
      if (y !== undefined && y - touchStartY > 4)
        stickToBottomRef.current = false
    }

    viewport.addEventListener("scroll", onScroll, { passive: true })
    viewport.addEventListener("wheel", onWheel, { passive: true })
    viewport.addEventListener("touchstart", onTouchStart, { passive: true })
    viewport.addEventListener("touchmove", onTouchMove, { passive: true })
    return () => {
      mounted = false
      if (frame !== null) cancelAnimationFrame(frame)
      observer.disconnect()
      viewport.removeEventListener("scroll", onScroll)
      viewport.removeEventListener("wheel", onWheel)
      viewport.removeEventListener("touchstart", onTouchStart)
      viewport.removeEventListener("touchmove", onTouchMove)
    }
  }, [getViewport, story.id])

  // Screen-reader status. The streamed prose itself is NOT a live region — that
  // would re-announce the whole growing passage on every 3-word chunk — so the
  // canvas announces the lifecycle instead. Each string is constant for the
  // whole of its phase, so a generation speaks at most twice: once when the
  // model starts thinking and once when prose begins. The elapsed counter beside
  // the dots is aria-hidden for the same reason the prose is — a live region
  // that re-announced it would say "thinking 1s, thinking 2s" for the length of
  // the wait. Clearing on idle is silent: the finished passage is then ordinary
  // page content in a StoryEntryBlock.
  const announcement =
    status === "thinking" ? "Thinking…" : live ? "Generating…" : ""

  // Following the prose is NOT driven from here. The ResizeObserver above owns
  // it: growth is a resize, and letting the DOM report it keeps the scroll off
  // React's commit schedule entirely — no effect firing per chunk, and no second
  // scrollTop write racing the observer's.

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div
        ref={contentRef}
        // The bottom reservation tracks the real composer height (published as
        // --composer-h by the workspace); the fallback matches its resting size.
        // break-words is load-bearing, not cosmetic: the viewport scrolls on
        // BOTH axes (Base UI sets overflow:scroll inline), so any single
        // unbreakable token — a pasted URL, a long imported genre — turns the
        // manuscript into a horizontally pannable page on touch.
        className="mx-auto w-full max-w-2xl px-6 pt-12 pb-[calc(var(--composer-h,11rem)+2rem)] break-words"
      >
        <span role="status" aria-live="polite" className="sr-only">
          {announcement}
        </span>
        {/* An imported scenario's "genre" is often its whole tag list, and the
            badge is whitespace-nowrap by design — so it must be allowed to
            shrink and ellipsise here, or it sets the width of the canvas. */}
        <div className="mb-2 flex min-w-0 items-center gap-2">
          <Badge
            variant="outline"
            className="min-w-0 shrink truncate"
            title={story.genre}
          >
            {story.genre}
          </Badge>
          <span className="shrink-0 text-xs text-muted-foreground">
            Started {formatDateShort(story.createdAt)}
          </span>
        </div>
        <h2 className="font-serif text-3xl font-semibold tracking-tight">
          {story.title}
        </h2>
        {story.description && (
          <p className="mt-2 font-serif text-base leading-7 text-muted-foreground italic">
            {story.description}
          </p>
        )}
        <Separator className="mx-auto my-10 w-16" />

        {!hasContent ? (
          <CanvasEmptyState story={story} onSuggestion={onSuggestion} />
        ) : (
          <>
            <div className="space-y-1">
              {/* `isLast` is measured against the FILTERED list — the one being
                  rendered — so the Retry action always sits on the block the
                  reader can actually see at the end of the manuscript. While a
                  retry is in flight its own passage is hidden and the block
                  above inherits the action, which is harmless: everything in
                  the cluster is disabled by `busy` for the whole of it. */}
              {entries.map((entry, index) => (
                <StoryEntryBlock
                  key={entry.id}
                  entry={entry}
                  storyId={story.id}
                  busy={busy}
                  isLast={index === entries.length - 1}
                  onRetry={onRetry}
                />
              ))}

              {/* Optimistic echo: the passage the reader just wrote, shown
                  from the moment they send it until revalidation hands back the
                  persisted row. It dims only for the round-trip that decides
                  whether the server accepts it — once acknowledged it reads as
                  finished prose, which is what it is, even though this element
                  goes on standing in for the row for the rest of the
                  generation. */}
              {optimisticUserText !== null && (
                <div
                  data-source="user"
                  data-unacknowledged={optimisticUserPending || undefined}
                  className={cn(
                    "relative -mx-4 border-l-2 border-primary/40 px-4 py-3 transition-opacity duration-200",
                    optimisticUserPending && "opacity-50"
                  )}
                >
                  <Prose text={optimisticUserText} />
                </div>
              )}

              {showTail && (
                <StreamingBlock
                  text={streamingText}
                  pending={status === "pending"}
                  caret={live}
                  status={status}
                />
              )}
            </div>

            {/* A resting mark at the live edge of the manuscript. Deliberately
                still: it used to pulse like a text cursor, which promised an
                insertion point at the end of a canvas nobody can type into —
                the composer is where you type. It stays as a place-marker for
                where the next passage will begin, and the moment one starts the
                inline GenerationCaret takes over. */}
            {!showTail && (
              <div aria-hidden className="mt-6 h-5 w-0.5 bg-primary/30" />
            )}
          </>
        )}
      </div>
    </ScrollArea>
  )
}
