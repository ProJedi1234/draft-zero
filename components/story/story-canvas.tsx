"use client"

import * as React from "react"

import type { Story } from "@/lib/types"
import { formatDateShort } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { CanvasEmptyState } from "@/components/story/canvas-empty-state"
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
  removingEntryIds,
  onRetryFrom,
  onSuggestion,
}: {
  story: Story
  status: GenerationStatus
  busy: boolean
  streamingText: string
  optimisticUserText: string | null
  removingEntryIds: string[]
  onRetryFrom: (entryId: string) => void
  onSuggestion: (text: string) => void
}) {
  const contentRef = React.useRef<HTMLDivElement>(null)
  // Sticky by default; flipped off the moment the reader scrolls away.
  const stickToBottomRef = React.useRef(true)

  const generating = status !== "idle"
  const removing = new Set(removingEntryIds)
  const entries = story.entries.filter((entry) => !removing.has(entry.id))
  const hasContent =
    entries.length > 0 || optimisticUserText !== null || generating

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

    stickToBottomRef.current = true
    viewport.scrollTop = viewport.scrollHeight

    // Fonts and the measured composer padding can settle a frame later; correct
    // the landing position once, unless the writer already scrolled away.
    const frame = requestAnimationFrame(() => {
      if (!stickToBottomRef.current) return
      viewport.scrollTop = viewport.scrollHeight
    })

    const onScroll = () => {
      const distance =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      stickToBottomRef.current = distance <= STICK_THRESHOLD_PX
    }

    viewport.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener("scroll", onScroll)
    }
  }, [getViewport, story.id])

  // Screen-reader status. The streamed prose itself is NOT a live region — that
  // would re-announce the whole growing passage on every 3-word chunk — so the
  // canvas announces the lifecycle instead. The text is the same string for the
  // whole of pending+streaming, so it is spoken exactly once per generation, and
  // clearing it on idle is silent: the finished passage is then ordinary page
  // content in a StoryEntryBlock.
  const announcement = generating ? "Generating…" : ""

  // Follow the prose as it grows — but only for a reader who was already at the
  // bottom. Scrolling up during a generation is never overridden.
  React.useEffect(() => {
    if (!generating || !stickToBottomRef.current) return
    const viewport = getViewport()
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
  }, [generating, getViewport, optimisticUserText, streamingText])

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div
        ref={contentRef}
        // The bottom reservation tracks the real composer height (published as
        // --composer-h by the workspace); the fallback matches its resting size.
        className="mx-auto w-full max-w-2xl px-6 pt-12 pb-[calc(var(--composer-h,11rem)+2rem)]"
      >
        <span role="status" aria-live="polite" className="sr-only">
          {announcement}
        </span>
        <div className="mb-2 flex items-center gap-2">
          <Badge variant="outline">{story.genre}</Badge>
          <span className="text-xs text-muted-foreground">
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
              {entries.map((entry) => (
                <StoryEntryBlock
                  key={entry.id}
                  entry={entry}
                  storyId={story.id}
                  busy={busy}
                  onRetryFrom={onRetryFrom}
                />
              ))}

              {/* Optimistic echo: the passage the reader just wrote, shown
                  until revalidation hands back the persisted row. */}
              {optimisticUserText !== null && (
                <div
                  data-source="user"
                  className="relative -mx-4 border-l-2 border-primary/40 px-4 py-3"
                >
                  {optimisticUserText.split("\n\n").map((paragraph, i) => (
                    <p
                      key={i}
                      className="font-serif text-[1.0625rem] leading-8 text-foreground [&:not(:first-child)]:mt-5"
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
              )}

              {generating && (
                <StreamingBlock
                  text={streamingText}
                  pending={status === "pending"}
                />
              )}
            </div>

            {/* Idle insertion caret; while streaming the caret lives inline at
                the end of the streamed text instead. */}
            {!generating && (
              <div
                aria-hidden
                className="mt-6 h-5 w-0.5 animate-pulse bg-primary/50"
              />
            )}
          </>
        )}
      </div>
    </ScrollArea>
  )
}
