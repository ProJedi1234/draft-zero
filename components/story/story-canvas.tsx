"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"

import { loadOlderEntries } from "@/lib/actions/entries"
import { mergeWindowedEntries } from "@/lib/story-window"
import type { Story, StoryEntry } from "@/lib/types"
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

/**
 * How long the viewport must be scroll-quiet before a fetched page of older
 * passages is allowed to land. Long enough to outlast the gap between two
 * momentum scroll events, short enough that a page appears the moment a flick
 * settles.
 */
const SCROLL_REST_MS = 120

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
  // The initial landing at the live edge happens ONCE per story mount. The
  // landing effect below can legitimately re-run without a remount — dev Fast
  // Refresh re-runs every effect on a hot update — and re-pinning then throws
  // a reader who has scrolled up back to the bottom of the manuscript.
  const landedRef = React.useRef(false)

  // Older passages paged in on scroll-up. The server ships only a tail of a
  // long manuscript (Story.hasMoreBefore); the rest arrives here in pages,
  // held in state that survives router.refresh() — this component lives in
  // the story-keyed editor subtree, so an RSC refresh re-renders it without
  // remounting, and a story switch resets everything.
  const [older, setOlder] = React.useState<StoryEntry[]>([])
  // Null defers to the fresh server answer; set once the first page reports.
  const [hasMoreOlder, setHasMoreOlder] = React.useState<boolean | null>(null)
  const olderSentinelRef = React.useRef<HTMLDivElement>(null)
  /** The oldest loaded position — the next page's cursor. */
  const olderCursorRef = React.useRef<number | null>(null)
  const olderLoadingRef = React.useRef(false)
  /** scrollHeight captured just before a prepend, for scroll anchoring. */
  const anchorRef = React.useRef<{ height: number } | null>(null)
  /** A resolved page waiting for the scroller to come to rest. */
  const pendingPageRef = React.useRef<{
    entries: StoryEntry[]
    windowStartPosition: number | null
    hasMore: boolean
  } | null>(null)
  const flushTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Last scroll event on the viewport, for the at-rest gate below. */
  const lastScrollAtRef = React.useRef(0)

  // Live means the provider still owns the passage. `settling` is neither live
  // nor idle: the prose is finished and rendered from the local buffer while its
  // row is in flight, so the block stays but the caret and the Stop affordance
  // go — and the hook empties the buffer in the commit that delivers the row.
  const live =
    status === "pending" || status === "thinking" || status === "streaming"
  const showTail = live || streamingText !== ""
  const removing = new Set(removingEntryIds)
  // Paged-in prose first, then the server tail; the tail's copy wins any
  // overlap — the window can slide back across passages already paged in.
  const entries = mergeWindowedEntries(older, story.entries).filter(
    (entry) => !removing.has(entry.id)
  )
  const moreAbove = hasMoreOlder ?? story.hasMoreBefore ?? false
  const hasContent =
    entries.length > 0 || optimisticUserText !== null || showTail

  const getViewport = React.useCallback(
    () =>
      contentRef.current?.closest<HTMLElement>(
        '[data-slot="scroll-area-viewport"]'
      ) ?? null,
    []
  )

  // A prepend only ever lands while the scroller is AT REST. Safari (the
  // finger-driven Safaris especially) runs momentum and rubber-band scrolling
  // as an animation that overrides programmatic scrollTop writes — so a
  // compensation applied mid-flick is silently swallowed and the reader is
  // dumped at an uncompensated position: the "scroll up and get thrown back"
  // bug. Deferring the WHOLE application (prepend + compensation together)
  // until the viewport has been quiet for a beat sidesteps the entire class:
  // at-rest writes are honored everywhere, and the sentinel's rootMargin
  // means the page is usually ready to land in the pause between flicks.
  // Self-rescheduling closure reaches itself through a ref: the timer may
  // outlive the render that armed it.
  const flushRef = React.useRef<(() => void) | null>(null)
  const flushPendingPage = React.useCallback(() => {
    const page = pendingPageRef.current
    if (!page) return
    const sinceScroll = Date.now() - lastScrollAtRef.current
    if (sinceScroll < SCROLL_REST_MS) {
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current)
      flushTimerRef.current = setTimeout(
        () => flushRef.current?.(),
        SCROLL_REST_MS - sinceScroll + 10
      )
      return
    }
    pendingPageRef.current = null
    const viewport = getViewport()
    // Only the pre-prepend HEIGHT is captured — deliberately not scrollTop.
    // The layout effect adjusts RELATIVELY from wherever the reader is at
    // commit, so nothing they did in the meantime is thrown away.
    anchorRef.current = viewport ? { height: viewport.scrollHeight } : null
    if (page.windowStartPosition !== null)
      olderCursorRef.current = page.windowStartPosition
    setHasMoreOlder(page.hasMore)
    setOlder((prev) => [
      ...page.entries.filter(
        (entry) => !prev.some((held) => held.id === entry.id)
      ),
      ...prev,
    ])
    // The fetch lock opens only now: a page in the buffer is a page in
    // flight, or the sentinel would stack fetches behind it.
    olderLoadingRef.current = false
  }, [getViewport])
  useIsomorphicLayoutEffect(() => {
    flushRef.current = flushPendingPage
  }, [flushPendingPage])

  const loadOlder = React.useCallback(async () => {
    if (olderLoadingRef.current) return
    const cursor = olderCursorRef.current ?? story.windowStartPosition
    if (cursor === undefined || cursor === null) return
    olderLoadingRef.current = true
    const res = await loadOlderEntries(story.id, cursor)
    // Silent failure: the sentinel is still there and the next notch of
    // scroll retries. A toast for "scrolling briefly didn't work" is noise.
    if (!res.ok) {
      olderLoadingRef.current = false
      return
    }
    pendingPageRef.current = {
      entries: res.data.entries,
      windowStartPosition: res.data.windowStartPosition,
      hasMore: res.data.hasMore,
    }
    flushPendingPage()
  }, [story.id, story.windowStartPosition, flushPendingPage])

  // The at-rest gate's clock, plus cleanup for a flush left scheduled.
  React.useEffect(() => {
    const viewport = getViewport()
    if (!viewport) return
    const onScroll = () => {
      lastScrollAtRef.current = Date.now()
    }
    viewport.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      viewport.removeEventListener("scroll", onScroll)
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current)
    }
  }, [getViewport, story.id])

  // Scroll anchoring for the prepend: keep the passage under the reader's
  // eyes where it is by growing scrollTop by exactly what the content above
  // it grew — relative to wherever the reader is NOW, so scrolling done while
  // the page was in flight survives. Runs before paint; the pin-to-bottom
  // observer cannot fight it, because reaching the sentinel required
  // scrolling up, which unsticks it. The manuscript div carries
  // [overflow-anchor:none], so this is the ONLY compensation — a browser's
  // native scroll anchoring adjusting alongside it would double-count.
  useIsomorphicLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    anchorRef.current = null
    const viewport = getViewport()
    if (!viewport) return
    const grown = viewport.scrollHeight - anchor.height
    if (grown > 0) viewport.scrollTop += grown
  }, [older, getViewport])

  // The trigger: a sentinel above the first passage, watched against the
  // scroll viewport. rootMargin starts the fetch early so the reader
  // scrolls into prose, not into a gap.
  React.useEffect(() => {
    const sentinel = olderSentinelRef.current
    if (!sentinel || !moreAbove) return
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((entry) => entry.isIntersecting)) void loadOlder()
      },
      { root: getViewport(), rootMargin: "1200px 0px 0px 0px" }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [moreAbove, loadOlder, getViewport])

  // Foreign edits reach the tail through router.refresh(), but a paged-in
  // passage lives in state — so when the story moves, re-read the range this
  // canvas holds and MERGE fresh copies over the held ones, by id. Never a
  // replacement: pages can land while this request is in flight, and an
  // effect re-run (dev Fast Refresh re-runs them all) must not be able to
  // shrink the loaded window, move the paging cursor, or shift the view —
  // exactly what a count-sized replacement did. Rows deleted on another
  // device keep a stale copy here until the next story switch; that is the
  // cheapest honest answer for a read this rare. On failure the held prose
  // stands; it is almost always identical.
  const heldCount = older.length
  React.useEffect(() => {
    if (heldCount === 0) return
    if (story.windowStartPosition === undefined) return
    let cancelled = false
    void loadOlderEntries(story.id, story.windowStartPosition, heldCount).then(
      (res) => {
        if (cancelled || !res.ok) return
        const fresh = new Map(
          res.data.entries.map((entry) => [entry.id, entry])
        )
        setOlder((prev) => prev.map((entry) => fresh.get(entry.id) ?? entry))
      }
    )
    return () => {
      cancelled = true
    }
    // Deliberately NOT keyed on heldCount: it re-fires only when the story
    // itself moves, not when a page arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id, story.updatedAt])

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
    // the browser paint the top of the manuscript first. Once per story mount
    // (see landedRef) — a re-run of this effect re-attaches the observers and
    // listeners below but must not move a reader who has walked away.
    if (!landedRef.current) {
      landedRef.current = true
      stickToBottomRef.current = true
      pinNow()
    }

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
        className="mx-auto w-full max-w-2xl px-6 pt-12 pb-[calc(var(--composer-h,11rem)+2rem)] break-words [overflow-anchor:none]"
      >
        <span role="status" aria-live="polite" className="sr-only">
          {announcement}
        </span>
        {/* The title page renders only once the manuscript's TRUE beginning
            is loaded. On a windowed story the top of the loaded prose is not
            the top of the story, and a title sitting above it says "this is
            where it starts" — the one thing that edge must never claim. Until
            then the same slot holds a quiet loading mark, so reaching it
            reads as "still fetching", not "you have arrived". The swap
            happens in the same commit as the final page landing, so the
            anchoring effect's height delta covers it and the view stays put. */}
        {moreAbove ? (
          <div
            aria-hidden
            className="flex justify-center py-10 text-muted-foreground"
          >
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : (
          <>
            {/* An imported scenario's "genre" is often its whole tag list, and
                the badge is whitespace-nowrap by design — so it must be
                allowed to shrink and ellipsise here, or it sets the width of
                the canvas. */}
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
          </>
        )}

        {!hasContent ? (
          <CanvasEmptyState story={story} onSuggestion={onSuggestion} />
        ) : (
          <>
            <div className="space-y-1">
              {/* Watched by the IntersectionObserver above. Rendered only
                  while older passages exist, so a finished manuscript top is
                  just the top. aria-hidden: it is scroll plumbing, not
                  content. */}
              {moreAbove && (
                <div ref={olderSentinelRef} aria-hidden className="h-px" />
              )}
              {/* `followingCount` is measured against the FILTERED list — the
                  one being rendered — so Retry always sits on the block the
                  reader can actually see at the end of the manuscript, and a
                  rewind offers to remove the number of passages they can
                  actually count. While a retry is in flight its own passage is
                  hidden and the block above inherits the action, which is
                  harmless: everything in the cluster is disabled by `busy` for
                  the whole of it. */}
              {entries.map((entry, index) => (
                <StoryEntryBlock
                  key={entry.id}
                  entry={entry}
                  storyId={story.id}
                  busy={busy}
                  followingCount={entries.length - 1 - index}
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
