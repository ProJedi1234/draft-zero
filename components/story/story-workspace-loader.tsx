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
import { StoryTint } from "@/components/story/story-tint"
import { StoryWorkspace } from "@/components/story/story-workspace"

/**
 * This shell reads the store for a title and a pending flag, so it re-renders
 * on every store change — a snapshot landing, another device's write, any row
 * moving. Without this the manuscript re-rendered with each of them, on props
 * that had not changed at all.
 */
const MemoWorkspace = React.memo(StoryWorkspace)

/**
 * The title lands at once; the ruled lines wait this long.
 *
 * Payloads persist to IndexedDB, so a story opened before on this device seeds
 * from disk with no network at all and the skeleton never appears. This gate is
 * for the ones that miss by a hair: a few frames of lines that appear and are
 * gone read as a flicker, where the title alone is simply the page arriving.
 */
const LINES_GATE_MS = 120

/**
 * Line widths, grouped into paragraphs. Not a claim about the manuscript — the
 * shape of that is unknown until it lands — but ruled lines all of one length
 * read as a table, and a single flat stack reads as a form. Three uneven
 * groups is the least that reads as prose.
 */
const PARAGRAPHS = [
  [96, 89, 93, 58],
  [91, 95, 73],
  [88, 94, 90, 41],
]

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
  const loading = payload === null

  const [linesShown, setLinesShown] = React.useState(false)
  React.useEffect(() => {
    if (!loading) return
    const timer = window.setTimeout(() => setLinesShown(true), LINES_GATE_MS)
    return () => {
      window.clearTimeout(timer)
      setLinesShown(false)
    }
  }, [loading, storyId])

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
    return (
      <WorkspaceSkeleton
        title={known?.title ?? ""}
        state={state}
        tintHue={known?.tintHue ?? null}
        tintStrength={known?.tintStrength ?? 0}
        linesShown={linesShown}
      />
    )
  }

  return (
    <MemoWorkspace
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
 * holds the column and the title rather than miming passages that may not
 * exist. It sits on the measure the prose will use, so the lines are replaced
 * roughly where they stood and the swap costs no reflow of the page around it.
 */
function WorkspaceSkeleton({
  title,
  state,
  tintHue,
  tintStrength,
  linesShown,
}: {
  title: string
  state: "ready" | "loading" | "missing" | "error"
  tintHue: number | null
  tintStrength: number
  linesShown: boolean
}) {
  // The chrome wears the tint from the first frame: the store row that carries
  // the title carries the hue, so there is no reason to open a story into
  // somebody else's colour and correct it a moment later.
  const tint = <StoryTint hue={tintHue} strength={tintStrength} />

  if (state === "error") {
    return (
      <div className="h-app overflow-y-auto">
        {tint}
        <div className="mx-auto w-full max-w-3xl px-4 pt-10 sm:px-6">
          <h1 className="mb-8 min-w-0 truncate font-serif text-2xl tracking-tight">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">
            Could not reach the server. Retrying when the connection returns.
          </p>
        </div>
      </div>
    )
  }

  let line = 0
  return (
    <div className="h-app overflow-y-auto">
      {tint}
      <div className="mx-auto w-full max-w-3xl px-4 pt-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6">
        <h1 className="mb-8 min-w-0 truncate font-serif text-2xl tracking-tight">
          {title === "" ? (
            <span className="skeleton-line block h-7 w-56 rounded" />
          ) : (
            title
          )}
        </h1>
        {linesShown && (
          <div className="flex animate-in flex-col gap-7 duration-300 fade-in">
            {PARAGRAPHS.map((widths, group) => (
              <div key={group} className="flex flex-col gap-3">
                {widths.map((width) => (
                  <span
                    key={width}
                    className="skeleton-line h-4 rounded"
                    style={{
                      width: `${width}%`,
                      animationDelay: `${line++ * 90}ms`,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
