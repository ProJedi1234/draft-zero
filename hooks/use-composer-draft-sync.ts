"use client"

// hooks/use-composer-draft-sync.ts — Magic sync for the composer's unsent
// state: the text and the armed Do/Say/Image mode, travelling as one payload.
//
// The composer is unlike the §4.2 fields it joins: its value is real React
// state (the send path clears it, the suggestion chips fill it), so there is
// no DOM to reconcile — adoption is just a setState. What this hook adds
// around that state is the two halves of sync:
//
//   OUT: every user-driven change is debounced into POST /api/draft, which
//   upserts the story's draft row (the durable copy the next mount seeds from)
//   and publishes a `draft` bus event carrying the payload (the instant copy
//   every other open device adopts straight off the wire).
//
//   IN: `draft` events for this story arrive via the draftRelay singleton and
//   are written into the state, unless they are our own echo, older than what
//   is on display, or racing a save of ours that has not resolved —
//   shouldAdoptDraft in lib/sync/draft.ts is that decision, and its test file
//   is the specification.
//
// Two devices typing in the same composer at once resolve last-writer-wins by
// server arrival order. That is the honest contract for a textarea: there is
// exactly one draft, and the machinery exists to hand it over, not to merge it.

import * as React from "react"

import { useAutosave } from "@/hooks/use-autosave"
import { draftRelay, syncClientId } from "@/lib/sync/client"
import { shouldAdoptDraft, type DraftPayload } from "@/lib/sync/draft"
import type { ActionResult, ComposerMode } from "@/lib/types"

export function useComposerDraftSync({
  storyId,
  initialVersion,
  adopt,
  resyncRef,
}: {
  storyId: string
  /** The seeded row's updated_at, or null when the story had no draft. */
  initialVersion: string | null
  /**
   * Write an adopted draft into the composer state. Must be stable. `mode` is
   * null only from the resync probe's 204 — a composer never touched has no
   * mode on record, and the one already armed is as good an answer as any.
   */
  adopt: (text: string, mode: ComposerMode | null) => void
  /** Bridge from the workspace's sync registration: reconnect → re-read the row. */
  resyncRef: { current: (() => void) | null }
}): {
  /**
   * Announce a user-driven change. The caller pairs this with its own
   * setState; adopted foreign values must NOT come back through here, or two
   * devices would volley the same state for ever.
   */
  publish: (value: DraftPayload) => void
} {
  const versionRef = React.useRef(initialVersion)
  // The last user payload the server has not acknowledged. Non-null suspends
  // adoption (see shouldAdoptDraft); cleared — by reference, publish hands
  // schedule the same object — when the save for exactly this payload
  // resolves, so a superseded save cannot end a newer edit's claim.
  const pendingRef = React.useRef<DraftPayload | null>(null)

  const save = useAutosave(
    React.useCallback(
      async (payload: DraftPayload): Promise<ActionResult> => {
        const res = await fetch("/api/draft", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            storyId,
            text: payload.text,
            mode: payload.mode,
            origin: syncClientId,
          }),
          // The last save before a tab closes is the one that matters most —
          // let it outlive the page.
          keepalive: true,
        })
        if (!res.ok) return { ok: false, error: "Couldn't sync your draft." }
        const data = (await res.json()) as { version: string }
        if (versionRef.current === null || data.version > versionRef.current) {
          versionRef.current = data.version
        }
        if (pendingRef.current === payload) pendingRef.current = null
        return { ok: true, data: null }
      },
      [storyId]
    )
  )

  const { schedule, flush, status } = save

  // A failed save gets no echo, and waiting for one would latch adoption shut
  // for the life of the mount — same release valve as useServerSyncedField.
  React.useEffect(() => {
    if (status === "error") pendingRef.current = null
  }, [status])

  const publish = React.useCallback(
    (value: DraftPayload) => {
      pendingRef.current = value
      schedule(value)
    },
    [schedule]
  )

  React.useEffect(
    () =>
      draftRelay.subscribe((event) => {
        const take = shouldAdoptDraft(event, {
          storyId,
          selfOrigin: syncClientId,
          pending: pendingRef.current,
          version: versionRef.current,
        })
        if (!take) return
        versionRef.current = event.version
        adopt(event.text, event.mode)
      }),
    [storyId, adopt]
  )

  // Events missed while the socket was down are gone for good; one read of the
  // row is their sum. The workspace calls through this ref on every reconnect,
  // the same way it re-probes the run channels.
  const resync = React.useCallback(() => {
    void (async () => {
      try {
        const params = new URLSearchParams({ storyId })
        const res = await fetch(`/api/draft?${params.toString()}`, {
          cache: "no-store",
        })
        // A save of ours is travelling — its landing will set the row anyway.
        if (pendingRef.current !== null) return
        if (res.status === 204) {
          // No row: this composer has never been touched (a cleared draft
          // still leaves a row for its mode), so anything we hold is a save
          // that never landed. The version deliberately stays — a stale event
          // that limps in later must still lose to what we knew.
          adopt("", null)
          return
        }
        if (!res.ok) return
        const data = (await res.json()) as {
          text: string
          mode: ComposerMode
          version: string
        }
        if (versionRef.current !== null && data.version <= versionRef.current)
          return
        versionRef.current = data.version
        adopt(data.text, data.mode)
      } catch {
        // A probe that failed is a socket about to reconnect again; the next
        // one covers it.
      }
    })()
  }, [storyId, adopt])

  React.useEffect(() => {
    resyncRef.current = resync
    return () => {
      resyncRef.current = null
    }
  }, [resyncRef, resync])

  // Going hidden is the last moment before iOS freezes the tab — flush the
  // debounce now or the newest keystrokes exist nowhere but a suspended page.
  React.useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush()
    }
    document.addEventListener("visibilitychange", onHide)
    return () => document.removeEventListener("visibilitychange", onHide)
  }, [flush])

  return { publish }
}
