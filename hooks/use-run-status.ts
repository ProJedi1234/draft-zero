"use client"

// hooks/use-run-status.ts — What each story in the library is doing, right now.
//
// Two sources, because neither alone is enough:
//
//   the server's list   every run in flight, arriving with each RSC payload.
//                       Authoritative, and the only thing that survives a
//                       reload — but it can only ever say "running" or not.
//   the sync channel    run-ended, carrying the status. This is what turns a
//                       row that stopped running into either a landed passage
//                       or a failure, which the refetched tree cannot say.
//
// The third state — "finished while you were reading something else" — is
// purely local. The server has no idea which story is open on which device, so
// an ending is remembered here and spent when the writer opens that story.
// Nothing is persisted: a mark is a fact about this session's attention, and a
// reload is the writer having looked away for long enough that we would be
// guessing.
//
// `reconcile` is pure and exported because it is the specification — see
// tests/run-status.test.ts. Everything subtle lives there rather than in an
// effect, for the same reason `adopt` does in use-server-synced.ts.

import * as React from "react"

import type { RunMarkState } from "@/components/sidebar/story-run-mark"
import { runEndings } from "@/lib/sync/client"
import type { ActiveRun, RunEndStatus } from "@/lib/sync/types"

export interface RunStatus {
  state: RunMarkState
  /** Server start time for a working story, so the row can count up. Null otherwise. */
  startedAt: string | null
}

/** How a run ended, until the writer opens that story and spends it. */
export type UnseenEnding = Extract<RunMarkState, "done" | "failed">

const IDLE: RunStatus = { state: "idle", startedAt: null }

export function markFor(status: RunEndStatus): UnseenEnding {
  // A run the writer stopped on purpose is not news, and marking it would
  // train them to ignore the mark. It persisted whatever prose it had, so it
  // is not a failure either — it is simply nothing to report.
  return status === "error" ? "failed" : "done"
}

/**
 * Fold a fresh view of the world into the marks. Returns the same object when
 * nothing moved, so the caller can skip a render.
 *
 * Two rules, and the second is the interesting one:
 *
 * 1. The open story never holds a mark. The writer is watching that passage
 *    land in the manuscript itself; a badge on its own row is noise.
 * 2. A story that left the running set without this device hearing its ending
 *    is marked landed. That gap is real — a hidden tab holds no socket at all
 *    (see use-story-sync.ts), so switching browser tabs across a run's finish
 *    loses the event for good. Guessing "done" is right far more often than it
 *    is wrong, and a writer never told their passage arrived is the exact
 *    failure this feature exists to fix.
 */
export function reconcile(
  unseen: Readonly<Record<string, UnseenEnding>>,
  previouslyRunning: readonly string[],
  running: readonly string[],
  openStoryId: string | null
): Record<string, UnseenEnding> {
  const stillRunning = new Set(running)
  const next: Record<string, UnseenEnding> = { ...unseen }
  let changed = false

  for (const storyId of previouslyRunning) {
    if (stillRunning.has(storyId)) continue
    if (storyId === openStoryId) continue
    if (storyId in next) continue
    next[storyId] = "done"
    changed = true
  }

  if (openStoryId !== null && openStoryId in next) {
    delete next[openStoryId]
    changed = true
  }

  return changed ? next : (unseen as Record<string, UnseenEnding>)
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

export function useRunStatus(
  activeRuns: ActiveRun[],
  openStoryId: string | null
): (storyId: string) => RunStatus {
  const [unseen, setUnseen] = React.useState<Record<string, UnseenEnding>>({})

  const running = React.useMemo(() => {
    const byStory = new Map<string, ActiveRun>()
    for (const run of activeRuns) byStory.set(run.storyId, run)
    return byStory
  }, [activeRuns])
  const runningIds = React.useMemo(() => [...running.keys()], [running])

  // What the marks were last reconciled against. Compared during render rather
  // than in an effect: an effect would leave a spent mark on screen for a frame
  // after the writer opened the story, which is exactly the flicker the mark is
  // supposed to replace.
  const [seen, setSeen] = React.useState<{
    running: readonly string[]
    open: string | null
  }>(() => ({ running: runningIds, open: openStoryId }))

  let current = unseen
  if (seen.open !== openStoryId || !sameIds(seen.running, runningIds)) {
    current = reconcile(unseen, seen.running, runningIds, openStoryId)
    setSeen({ running: runningIds, open: openStoryId })
    if (current !== unseen) setUnseen(current)
  }

  // The live path. A callback, so no reconciliation is owed: an ending that
  // arrives while the writer is on that very story is simply not news.
  React.useEffect(() => {
    return runEndings.subscribe((event) => {
      if (event.storyId === openStoryId) return
      setUnseen((now) => ({ ...now, [event.storyId]: markFor(event.status) }))
    })
  }, [openStoryId])

  return React.useCallback(
    (storyId: string): RunStatus => {
      const run = running.get(storyId)
      // Running outranks an unseen ending: a story that finished and started
      // again is working, and the mark for the older run is stale.
      if (run) return { state: "working", startedAt: run.startedAt }
      const mark = current[storyId]
      return mark ? { state: mark, startedAt: null } : IDLE
    },
    [running, current]
  )
}
