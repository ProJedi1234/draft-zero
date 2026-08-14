// lib/sync/types.ts — The magic-sync wire contract. Pure types, isomorphic.
//
// Two NDJSON channels, both one JSON object per line:
//
//   GET /api/generation/subscribe?storyId=…[&runId=…]  → RunWireEvent per line.
//     Attaches to the story's live generation run. The first frame is always
//     `run` — a snapshot with everything streamed SO FAR compressed into it —
//     and only incremental events follow, so a device attaching mid-stream and
//     the device that started the run converge on identical state. 204 when
//     nothing is running (and the named runId, if any, is unknown).
//
//   GET /api/sync/events  → SyncWireEvent per line.
//     The long-lived "something changed" channel every open device holds. It
//     carries no data, only the fact of change — the client answers each
//     `change` with a router.refresh(), because with force-dynamic RSC the
//     refetch IS the sync.
//
// Subscribing is free of consequence by design: closing either stream detaches
// a listener and nothing else. Only stopGeneration() aborts the model.

import type { GenerationEvent, GenerationUsage } from "@/lib/generation/types"
import type { GenerationRequestKind } from "@/lib/types"

/** How a finished run ended. Mirrors SettledCallStatus on purpose. */
export type RunEndStatus = "ok" | "aborted" | "error"

/**
 * The snapshot frame. `text` and `reasoningChars` compress the history — a
 * subscriber never receives replayed chunk-by-chunk events, it receives where
 * the run IS and then watches it move.
 */
export interface RunFrame {
  type: "run"
  runId: string
  storyId: string
  requestKind: GenerationRequestKind
  /** The writer's persisted turn row, or null for Continue/Retry. */
  userEntryId: string | null
  /** Entry ids this run supersedes (the take a Retry replaces) — attachers hide them. */
  removingEntryIds: string[]
  /** Cumulative reasoning characters so far. */
  reasoningChars: number
  /** Prose so far. */
  text: string
}

/**
 * The terminal frame. Exactly one per run, always the last line. By the time it
 * is sent, the server has already persisted the passage (entryId) or decided
 * there was nothing to persist (null) — so a client acting on `end` is acting
 * on completed facts, not predictions.
 */
export interface RunEndFrame {
  type: "end"
  status: RunEndStatus
  /** The persisted story entry, when any prose survived. */
  entryId: string | null
  /** Provider message worth a toast, error status only. */
  error: string | null
  usage: GenerationUsage | null
}

export type RunWireEvent =
  | RunFrame
  /** Live incrementals: reasoning | text | usage. `meta` is server bookkeeping and is never forwarded. */
  | Exclude<GenerationEvent, { type: "meta" }>
  | { type: "ping" }
  | RunEndFrame

export type SyncWireEvent =
  | { type: "hello" }
  | { type: "ping" }
  /** Something persisted changed. Null storyId = global (library, settings). */
  | { type: "change"; storyId: string | null }
  /** A run began — devices on that story should attach to the subscribe channel. */
  | { type: "run-started"; storyId: string; runId: string }

/** Keepalive cadence for both channels; silence past ~2 intervals means the socket is dead. */
export const SYNC_PING_INTERVAL_MS = 20_000
