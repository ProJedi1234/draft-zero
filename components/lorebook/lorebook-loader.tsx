"use client"

// components/lorebook/lorebook-loader.tsx — The lorebook route's client shell.
//
// The twin of story-workspace-loader.tsx, and it exists for the same reason:
// opening the lorebook used to be a navigation that waited on the server to
// re-serialize every entry the browser was already holding. This paints from
// the store, and asks for a correction behind the paint.
//
// A story whose lore this device has never read still gets a skeleton — but
// that is the deep-link case, not the one the writer lives in. Arriving from
// the story, the workspace payload put the entries in the store before the
// lorebook button was clickable.

import * as React from "react"
import { notFound } from "next/navigation"

import { useLorebook, useStoreView } from "@/hooks/use-store"
import { revalidateLoreNow } from "@/lib/store/lore-revalidate"

import { LorebookView } from "@/components/lorebook/lorebook-view"
import { StoryTint } from "@/components/story/story-tint"

export function LorebookLoader({ storyId }: { storyId: string }) {
  const lore = useLorebook(storyId)
  const view = useStoreView()
  const story = view.storyById.get(storyId)

  // The correction. Runs on mount and on every story switch — cheap when the
  // store is already right, and the only thing that notices an entry another
  // device added while this one was on a different page.
  React.useEffect(() => {
    void revalidateLoreNow(storyId)
  }, [storyId])

  // Only once the LIBRARY is live: an empty story table mid-boot is not proof
  // the story is gone, and 404ing a real story because IndexedDB was cold is
  // worse than the wait this shell exists to remove. Same rule as the
  // workspace loader.
  if (story === undefined && view.storyStatus === "live") {
    notFound()
  }

  if (story === undefined) {
    return <LorebookSkeleton />
  }

  return (
    <>
      {/* The lorebook is still inside the story, so it wears the story's
          colour. Read from the store rather than the server so the atmosphere
          slider's optimistic value survives the navigation — see StoryTint. */}
      <StoryTint hue={story.tintHue} strength={story.tintStrength} />
      <LorebookView
        storyId={storyId}
        storyTitle={story.title}
        entries={lore.entries}
        loading={lore.status !== "live" && lore.entries.length === 0}
      />
    </>
  )
}

/**
 * Only for a story the store has never heard of — a cold deep link. Holds the
 * two-pane frame so nothing jumps when the real thing lands.
 */
function LorebookSkeleton() {
  return (
    <div className="flex h-app flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <span className="block h-4 w-40 animate-pulse rounded bg-card/60" />
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-80 shrink-0 flex-col gap-2 border-r p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-9 animate-pulse rounded bg-card/50"
              style={{ width: `${[92, 78, 85, 70, 88, 74, 90, 66][i]}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
