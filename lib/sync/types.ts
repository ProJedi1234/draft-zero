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
import type { EntityKind, EntityRecordMap } from "@/lib/store/records"
import type {
  ComposerMode,
  GenerationRequestKind,
  ImageAspectRatio,
} from "@/lib/types"

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

/**
 * The image run's snapshot frame — the picture-shaped twin of RunFrame, over
 * its own channel (GET /api/image/subscribe?storyId=…[&runId=…]). The latest
 * partial preview is compressed into it the way streamed prose is compressed
 * into `text`: an attacher gets where the draw IS, then watches it sharpen.
 */
export interface ImageRunFrame {
  type: "image-run"
  runId: string
  storyId: string
  /** What is being drawn — the alt text and the retry-after-error payload. */
  prompt: string
  /** The frame the manuscript reserves, so nothing moves when pixels land. */
  aspectRatio: ImageAspectRatio
  /** The slot a retry is redrawing, or null for a new beat at the end. */
  imageGroupId: string | null
  /** The sharpest partial so far, or null before the first one. */
  previewB64: string | null
  previewMediaType: string | null
}

/**
 * The image run's terminal frame. By the time it is sent the illustration row
 * is committed (imageId) or there is nothing to commit — same contract as
 * RunEndFrame: clients act on facts, not predictions.
 */
export interface ImageRunEndFrame {
  type: "end"
  status: RunEndStatus
  /** The persisted illustration, when a picture landed. */
  imageId: string | null
  /** Provider message worth a toast, error status only. */
  error: string | null
}

export type ImageRunWireEvent =
  | ImageRunFrame
  | { type: "partial"; b64: string; mediaType: string }
  | { type: "ping" }
  | ImageRunEndFrame

/**
 * The prompt derivation's snapshot frame, over its own channel
 * (GET /api/image-prompt/subscribe?storyId=…[&runId=…]). Third registry, third
 * channel, for the same reason the image one is separate from the text one: a
 * story may be streaming prose, drawing a picture and developing a brief all at
 * once, and a device has to be able to watch all three.
 *
 * `brief` is the part that has no twin on the other channels, and it is the
 * whole reason this frame carries more than text. The composer marks its lane
 * stale by comparing the brief the lane was developed FROM against the brief on
 * screen, and it learns the former from the falling edge of `deriving` — so a
 * device that attached halfway through would otherwise date the answer to
 * whatever its own textarea happened to hold. The run states what question it
 * is answering, and every device settles on the same one.
 */
export interface DeriveRunFrame {
  type: "derive-run"
  runId: string
  storyId: string
  /** The writer's brief, or "" for the older gesture: describe the story now. */
  brief: string
  /**
   * The chips muted when the run launched — the brief's other half, carried
   * for the same reason the brief is: the lane answers (brief, mutes), and a
   * device dating the lane against its own current mutes would mark it fresh
   * for a question the run was never asked.
   */
  excludedLoreIds: string[]
  /** The prompt so far, compressed the way RunFrame compresses prose. */
  text: string
}

/**
 * The derivation's terminal frame. By the time it is sent the settled prompt is
 * already in the draft row and already announced on the bus, so a device acting
 * on `end` is acting after the lane it is about to unlock has been handed to it.
 */
export interface DeriveRunEndFrame {
  type: "end"
  status: RunEndStatus
  /** Everything the model wrote. Empty when nothing survived. */
  text: string
  /** Provider message worth a toast, error status only. */
  error: string | null
}

export type DeriveRunWireEvent =
  | DeriveRunFrame
  /** One increment. `value` is the delta; the frame above carried the history. */
  | { type: "text"; value: string }
  | { type: "ping" }
  | DeriveRunEndFrame

/**
 * A row moved, WITH the row. The payload-carrying lane beside `change`: the
 * client store folds `data` straight in instead of refetching, and `version`
 * (the row's server-minted updated_at) is what a device holding something newer
 * turns a stale event away by — the same arbitration `draft` already uses.
 */
export interface EntityUpsertEvent<K extends EntityKind = EntityKind> {
  type: "entity"
  op: "upsert"
  entity: K
  id: string
  /** Scope for story-child entities; the story's own id for "story"; null for globals. */
  storyId: string | null
  /** ISO-8601 UTC; string order is chronological order. The LWW key. */
  version: string
  /** syncClientId of the acting device; null for server-initiated writes. */
  origin: string | null
  /** FULL row snapshot, not a patch. */
  data: EntityRecordMap[K]
}

export interface EntityDeleteEvent {
  type: "entity"
  op: "delete"
  entity: EntityKind
  id: string
  storyId: string | null
  version: string
  origin: string | null
}

export type EntityWireEvent = EntityUpsertEvent | EntityDeleteEvent

export type SyncWireEvent =
  | { type: "hello" }
  | { type: "ping" }
  /**
   * Something persisted changed. Null storyId = global (library, settings).
   *
   * `covered` means an `entity` event carrying this write's whole payload went
   * out on the same bus tick, so a store-lane client can skip its catch-up
   * read; `entities` names which kinds an UNCOVERED write touched, so a client
   * can skip a read it has no table for. Both are optional and additive — a
   * client that ignores them refreshes on every change exactly as before.
   */
  | {
      type: "change"
      storyId: string | null
      covered?: true
      entities?: EntityKind[]
    }
  | EntityWireEvent
  /** A run began — devices on that story should attach to the subscribe channel. */
  | { type: "run-started"; storyId: string; runId: string }
  /**
   * An illustration began — same handoff as run-started, aimed at the image
   * subscribe channel. Separate rather than a kind on run-started because the
   * two runs are independent: a story can stream prose and draw a picture at
   * once, and a device must attach to both.
   */
  | { type: "image-run-started"; storyId: string; runId: string }
  /**
   * A develop began — the third handoff, aimed at the derivation subscribe
   * channel. Separate for the same reason image-run-started is: the three runs
   * are independent, and the handler has to know which channel to attach.
   */
  | { type: "derive-run-started"; storyId: string; runId: string }
  /**
   * A run finished, anywhere. Unlike `run-started` this is for devices that are
   * NOT on that story: it is what lets the library mark a passage that landed
   * while the writer was reading something else. It carries the status because
   * the accompanying `change` cannot — a refetch shows only that the run is
   * gone, and a story that errored looks exactly like one that succeeded.
   */
  | {
      type: "run-ended"
      storyId: string
      runId: string
      status: RunEndStatus
    }
  /** The summarizer gave up on this story. See BusEvent's note on why it toasts. */
  | { type: "summary-stopped"; storyId: string }
  /**
   * The composer's unsent state moved on some device — the text, and which
   * move is armed, because the two travel as one gesture: restoring "I draw
   * my blade" under Say would hand the writer a different sentence. Like
   * `atmosphere`, this carries its payload instead of asking for a refetch —
   * a draft is a few hundred bytes that changes on a debounce cadence, and
   * answering each one with a full RSC round-trip would be almost all waste.
   * `origin` is the writing device's own id, so it can ignore its echo;
   * `version` is the row's updated_at, so a device holding a newer draft can
   * turn a stale event away. Empty text is the draft being cleared (sent, or
   * deleted) — the mode still rides, and still applies.
   */
  | {
      type: "draft"
      storyId: string
      text: string
      mode: ComposerMode
      /** The finished developed prompt, or null. Mid-stream text never rides. */
      imagePrompt: string | null
      imageAssisted: boolean
      imageStyle: string | null
      /**
       * The lore chips muted under the brief. Always an array — the row's NULL
       * and an empty list are the same fact, and only one of them travels.
       */
      imageExcludedLoreIds: string[]
      version: string
      origin: string
    }
  /**
   * Where the atmosphere picker is on this story. Unlike every other event
   * here this one is not "go and refetch" — a repaint already sends its own
   * `change` — it is the only account the writer gets of a job whose failures
   * are otherwise indistinguishable from its successes.
   */
  | {
      type: "atmosphere"
      storyId: string
      phase: AtmospherePhase
      message: string | null
    }

/**
 * Where a check is. "kept" and "painted" are both successes, split because one
 * changed the room and the other did not: for a kept scene, a spinner that
 * stops is the entire feedback there is to give.
 */
export type AtmospherePhase =
  "checking" | "kept" | "painted" | "failed" | "stopped"

/**
 * A run in flight right now, as the library sees it. Not a database row —
 * the registry in lib/generation/live.ts is the only place this exists, and it
 * dies with the process, which is correct: a run cannot outlive the server
 * that is streaming it.
 */
export interface ActiveRun {
  storyId: string
  runId: string
  /** Server wall-clock, ISO-8601. The client counts up from this rather than
   *  from when it happened to look — a phone that just woke must not restart
   *  the clock on a run that has been going for twenty minutes. */
  startedAt: string
}

/** Keepalive cadence for both channels; silence past ~2 intervals means the socket is dead. */
export const SYNC_PING_INTERVAL_MS = 20_000
