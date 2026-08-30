"use client"

import * as React from "react"
import { Feather, Search } from "lucide-react"

import type { GalleryImage } from "@/lib/types"
import type { ActiveRun } from "@/lib/sync/types"
import { cn } from "@/lib/utils"
import {
  filterStories,
  showLibrarySkeleton,
  useMutationQueueDepth,
  useStories,
} from "@/hooks/use-store"
import { useRunStatus } from "@/hooks/use-run-status"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ContinueCard } from "@/components/library/continue-card"
import { PictureRail } from "@/components/library/picture-rail"
import { StoryCard } from "@/components/library/story-card"
import { ImportScenarioButton } from "@/components/sidebar/import-scenario-button"
import { NewStoryButton } from "@/components/sidebar/new-story-button"

/** How many rows are rendered before "Load more" adds another window. */
const WINDOW = 20

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[0.625rem] tracking-[0.14em] text-muted-foreground uppercase">
      {children}
    </h2>
  )
}

/**
 * The library index's body — the app's front door, and the PWA's start URL.
 *
 * It deliberately does NOT try to be a better version of the sidebar's story
 * list. The sidebar is the switcher: always present, and the fastest way to a
 * story you have already decided on. This page answers the other question —
 * what was I doing, and get me back into it — which is why it leads with the
 * passage you were in the middle of and the pictures the library has made,
 * and puts the list of everything last.
 *
 * Rows come from the client store; the excerpts and the rail's pictures are
 * server props, refreshed with the RSC payload (a landing passage triggers
 * one, so the quoted prose keeps up with the manuscript without a second live
 * channel).
 */
export function LibraryView({
  excerpts,
  railImages,
  activeRuns,
}: {
  /** Story id → the tail of its latest passage. See listStoryExcerpts. */
  excerpts: Record<string, string>
  /** The newest illustrations, for the rail. */
  railImages: GalleryImage[]
  /** Runs in flight, from the registry — the same list the sidebar reads. */
  activeRuns: ActiveRun[]
}) {
  const { rows, status } = useStories()
  const [query, setQuery] = React.useState("")
  const trimmedQuery = query.trim()
  // No story is open on this route, so no mark is ever spent here — the
  // library is where a writer comes to find out a passage landed.
  const runStatus = useRunStatus(activeRuns, null)
  const depth = useMutationQueueDepth()
  // The rail's lightbox flies home to a tile's on-screen rect, so the page
  // holds still while it is up.
  const [viewerOpen, setViewerOpen] = React.useState(false)

  const filtered = React.useMemo(
    () => filterStories(rows, trimmedQuery),
    [rows, trimmedQuery]
  )

  // Render-time reset rather than an effect: a new query starts at the first
  // window, and adjusting during render avoids painting the old count first.
  const [visibleCount, setVisibleCount] = React.useState(WINDOW)
  const [lastQuery, setLastQuery] = React.useState(trimmedQuery)
  if (lastQuery !== trimmedQuery) {
    setLastQuery(trimmedQuery)
    setVisibleCount(WINDOW)
  }

  // Searching turns this into a results page: Continue and the rail step aside
  // rather than sitting above matches they have nothing to do with. It also
  // settles what would otherwise be a trap — the story quoted at the top is
  // held out of the list below it, and a held-out story must still be findable
  // by name.
  const searching = trimmedQuery !== ""
  const continueStory = searching
    ? null
    : // Not rows[0]: the store floats pending edits to the top, and a ghost
      // create has no route to continue into.
      (rows.find((story) => !story.pending) ?? null)
  const listed =
    continueStory === null
      ? filtered
      : filtered.filter((story) => story.id !== continueStory.id)
  const visible = listed.slice(0, visibleCount)

  return (
    <div className="flex h-app flex-col">
      {/*
        The header the library spent its whole life without. Every other view in
        the app has one, and this is the route an installed copy opens to — with
        no trigger here and no browser chrome to fall back on, a phone had no
        way to reach the sidebar at all.
      */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger />
        <h1 className="text-sm font-medium">Library</h1>
        <div className="flex-1" />
        {/* Unlabelled, which is also what stops a phone header from wrapping
            the way two labelled buttons did. */}
        <ImportScenarioButton variant="icon" />
        <NewStoryButton variant="icon" />
      </header>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          viewerOpen && "overflow-hidden"
        )}
      >
        {/*
          The bottom pad clears the home indicator when installed: the app
          paints edge to edge, so the last story in a scrolled list would
          otherwise sit under it. max() keeps the ordinary spacing everywhere
          the inset is 0.
        */}
        <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6">
          {showLibrarySkeleton(rows, status) ? (
            <div className="flex flex-col gap-3">
              <div className="h-40 animate-pulse rounded-xl border bg-card/40" />
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-lg border bg-card/40"
                />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <Empty className="pt-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Feather />
                </EmptyMedia>
                <EmptyTitle>Write your first story</EmptyTitle>
                <EmptyDescription>
                  draft zero keeps everything on this machine. Start a draft and
                  the library builds itself.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <div className="flex items-center gap-2">
                  <NewStoryButton size="sm" />
                  <ImportScenarioButton variant="button" />
                </div>
              </EmptyContent>
            </Empty>
          ) : (
            <>
              {continueStory ? (
                <ContinueCard
                  story={continueStory}
                  excerpt={excerpts[continueStory.id]}
                  run={runStatus(continueStory.id)}
                />
              ) : null}

              {searching ? null : (
                <PictureRail
                  images={railImages}
                  onViewerChange={setViewerOpen}
                />
              )}

              <section className="mt-7">
                <div className="mb-2 flex items-baseline gap-2">
                  <Eyebrow>Stories</Eyebrow>
                  {/* Matches while searching, the whole library otherwise —
                      a count that stays at 5 over one result is just wrong. */}
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {searching ? listed.length : rows.length}
                  </span>
                </div>
                {/* Search belongs to the list, not to the page: it sits with
                    the thing it filters and scrolls away with it. In the header
                    it would also be the app's second search box on screen at
                    once on desktop, meaning something different from the
                    sidebar's. */}
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    placeholder="Search stories"
                    aria-label="Search stories"
                    className="h-9 border-transparent bg-accent/60 pl-9 placeholder:text-muted-foreground/70"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setQuery("")
                    }}
                  />
                </div>

                {visible.length === 0 ? (
                  <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                    {/* Never claim no-match over a half-loaded set. */}
                    {status !== "live"
                      ? "Loading library…"
                      : searching
                        ? `No matches for “${trimmedQuery}”`
                        : "Nothing else yet."}
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {visible.map((story) => (
                      <li key={story.id}>
                        <StoryCard
                          story={story}
                          excerpt={excerpts[story.id]}
                          run={runStatus(story.id)}
                        />
                      </li>
                    ))}
                  </ul>
                )}

                {listed.length > visible.length ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2 w-full text-muted-foreground"
                    onClick={() => setVisibleCount((c) => c + WINDOW)}
                  >
                    Load more
                  </Button>
                ) : null}

                {/* The honest affordance: these edits are applied but not yet
                    durable. */}
                {depth > 0 ? (
                  <p className="px-2 py-2 text-xs text-muted-foreground">
                    Saving…
                  </p>
                ) : null}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
