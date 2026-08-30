"use client"

import { Feather } from "lucide-react"

import type { ActiveRun } from "@/lib/sync/types"
import { showLibrarySkeleton, useStories } from "@/hooks/use-store"
import { useRunStatus } from "@/hooks/use-run-status"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { StoryCard } from "@/components/library/story-card"
import { ImportScenarioButton } from "@/components/sidebar/import-scenario-button"
import { NewStoryButton } from "@/components/sidebar/new-story-button"

/**
 * The library index's body, driven by the client store instead of server
 * props. Sort order — pending edits first, then updatedAt DESC — comes from
 * the store's derived view, not from anything rendered here.
 *
 * The excerpts are server props, refreshed with the RSC payload: a landing
 * passage triggers one, so the quoted prose keeps up with the manuscript
 * without a second live channel.
 */
export function LibraryView({
  excerpts,
  activeRuns,
}: {
  /** Story id → the tail of its latest passage. See listStoryExcerpts. */
  excerpts: Record<string, string>
  /** Runs in flight, from the registry — the same list the sidebar reads. */
  activeRuns: ActiveRun[]
}) {
  const { rows, status } = useStories()
  // No story is open on this route, so no mark is ever spent here — the
  // library is where a writer comes to find out a passage landed.
  const runStatus = useRunStatus(activeRuns, null)

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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/*
          The bottom pad clears the home indicator when installed: the app
          paints edge to edge, so the last story in a scrolled list would
          otherwise sit under it. max() keeps the ordinary spacing everywhere
          the inset is 0.
        */}
        <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6">
          {showLibrarySkeleton(rows, status) ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
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
            <ul className="flex flex-col gap-2">
              {rows.map((story) => (
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
        </div>
      </div>
    </div>
  )
}
