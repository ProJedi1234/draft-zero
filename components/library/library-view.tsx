"use client"

import { Feather } from "lucide-react"

import { StoryCard } from "@/components/library/story-card"
import { ImportScenarioButton } from "@/components/sidebar/import-scenario-button"
import { NewStoryButton } from "@/components/sidebar/new-story-button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { showLibrarySkeleton, useStories } from "@/hooks/use-store"

/**
 * The library index's body, driven by the client store instead of server
 * props. Sort order — pending edits first, then updatedAt DESC — comes from
 * the store's derived view, not from anything rendered here.
 */
export function LibraryView() {
  const { rows, status } = useStories()

  if (showLibrarySkeleton(rows, status)) {
    return (
      <div className="h-app overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 pt-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6">
          <header className="mb-8 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <h1 className="min-w-0 font-serif text-2xl tracking-tight">
              Library
            </h1>
            <div className="flex items-center gap-2">
              <ImportScenarioButton variant="button" />
              <NewStoryButton size="sm" />
            </div>
          </header>
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-lg border bg-card/40"
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-app items-center justify-center">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Feather />
            </EmptyMedia>
            <EmptyTitle>Write your first story</EmptyTitle>
            <EmptyDescription>
              draft zero keeps everything on this machine. Start a draft and the
              library builds itself.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className="flex items-center gap-2">
              <NewStoryButton size="sm" />
              <ImportScenarioButton variant="button" />
            </div>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  return (
    <div className="h-app overflow-y-auto">
      {/*
        The bottom pad clears the home indicator when installed: the app paints
        edge to edge, so the last story in a scrolled list would otherwise sit
        under it. max() keeps the ordinary spacing everywhere the inset is 0.
      */}
      <div className="mx-auto w-full max-w-3xl px-4 pt-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6">
        {/*
          flex-wrap, and no shrink-0 on the actions: on a phone the heading and
          two labelled buttons are wider than the viewport, and a row that
          cannot shrink or wrap makes the whole page wider than the screen. That
          costs a horizontal scroll on the one screen the app opens to. Below
          ~sm the actions take their own line instead.
        */}
        <header className="mb-8 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <h1 className="min-w-0 font-serif text-2xl tracking-tight">
            Library
          </h1>
          <div className="flex items-center gap-2">
            <ImportScenarioButton variant="button" />
            <NewStoryButton size="sm" />
          </div>
        </header>

        <ul className="flex flex-col gap-2">
          {rows.map((story) => (
            <li key={story.id}>
              <StoryCard story={story} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
