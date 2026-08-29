"use client"

// components/story/story-workspace-loader.tsx — The story route's client shell.
//
// Switching stories used to be a navigation that waited on eight queries before
// anything moved. Now the route carries no data at all: this paints a workspace
// it has already loaded straight from memory, and a story it has not yet seen
// gets a skeleton wearing the real title — which the store knows the moment the
// sidebar does, including for a story the server has not been told about yet.

import * as React from "react"
import { notFound } from "next/navigation"

import { useStoreView } from "@/hooks/use-store"
import { useWorkspacePayload } from "@/hooks/use-workspace-payload"
import { StoryWorkspace } from "@/components/story/story-workspace"

export function StoryWorkspaceLoader({
  storyId,
  revision,
}: {
  storyId: string
  /** Changes on every server render of the route — see use-workspace-payload. */
  revision: string
}) {
  const { payload, state } = useWorkspacePayload(storyId, revision)
  const view = useStoreView()
  const known = view.storyById.get(storyId)

  // Only once the store is live: an empty table mid-boot is not proof a story
  // is gone, and 404ing a real story because IndexedDB was cold would be worse
  // than the wait this whole shell exists to remove.
  if (
    state === "missing" &&
    view.storyStatus === "live" &&
    known === undefined
  ) {
    notFound()
  }

  if (payload === null) {
    return <WorkspaceSkeleton title={known?.title ?? ""} state={state} />
  }

  return (
    <StoryWorkspace
      story={payload.story}
      composerDraft={payload.composerDraft}
      lorebookEntries={payload.lorebookEntries}
      models={payload.models}
      imageModels={payload.imageModels}
      imageModelPrice={payload.imageModelPrice}
      defaultImageModelId={payload.defaultImageModelId}
      costProfile={payload.costProfile}
      profiles={payload.profiles}
      defaultProfileId={payload.defaultProfileId}
      requireZdr={payload.requireZdr}
    />
  )
}

/**
 * Deliberately quiet: the manuscript's shape is unknown until it lands, so this
 * holds the column and the title rather than miming passages that may not exist.
 */
function WorkspaceSkeleton({
  title,
  state,
}: {
  title: string
  state: "ready" | "loading" | "missing" | "error"
}) {
  return (
    <div className="h-app overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 pt-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6">
        <h1 className="mb-8 min-w-0 truncate font-serif text-2xl tracking-tight">
          {title === "" ? (
            <span className="block h-7 w-56 animate-pulse rounded bg-card/60" />
          ) : (
            title
          )}
        </h1>
        {state === "error" ? (
          <p className="text-sm text-muted-foreground">
            Could not reach the server. Retrying when the connection returns.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-4 animate-pulse rounded bg-card/50"
                style={{ width: `${[96, 88, 92, 70, 84][i]}%` }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
