// lib/sync/draft.ts — Whose composer text wins. Pure and isomorphic; the
// decision the draft hook makes for every incoming `draft` event lives here so
// tests/composer-draft.test.ts can be its specification, the way
// tests/server-synced.test.ts is for the field hooks.

import type { DraftEvent } from "@/lib/sync/client"
import type { ComposerMode } from "@/lib/types"

/**
 * What one composer change is: the words and the move they are armed under,
 * inseparable on the wire because they are inseparable at the keyboard —
 * restoring "I draw my blade" under Say hands the writer a different sentence.
 */
export interface DraftPayload {
  text: string
  mode: ComposerMode
  /**
   * The image lane's state, travelling with the words for exactly the reason
   * the mode does: a brief handed to another device without the prompt it
   * developed into is a bill the writer pays a second time, and without the
   * style or the assistance flag the next ↵ means something else there than it
   * did here.
   */
  imagePrompt: string | null
  imageAssisted: boolean
  imageStyle: string | null
  /**
   * The lore chips muted under this brief. Per-send scratch state, but shared
   * scratch state: the writer who tapped a chip off on the phone and picks the
   * tablet up to hit ↵ meant that mute for the send, not for the device.
   * Always an array on the wire — an empty exclusion set has no second meaning
   * for a null to carry.
   */
  imageExcludedLoreIds: string[]
}

/** More chips than any brief can match; a longer list is a bug, not a mute. */
export const MAX_EXCLUDED_LORE_IDS = 200

/** Lorebook ids are UUIDs; this is slack, not a spec. */
export const MAX_LORE_ID_CHARS = 100

/**
 * Whether an untrusted body's exclusion list is one the draft row may hold.
 * Pure and exported so tests/composer-draft.test.ts can pin the bounds without
 * standing a route up.
 */
export function isExcludedLoreIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_EXCLUDED_LORE_IDS &&
    value.every(
      (id) =>
        typeof id === "string" && id !== "" && id.length <= MAX_LORE_ID_CHARS
    )
  )
}

/**
 * The origin a server-side write stamps on its `draft` event — today only the
 * prompt derivation, which settles the image lane from inside its own detached
 * run (lib/images/derive-run.ts).
 *
 * It lives here, beside the rule that reads origins, rather than in the module
 * that publishes it: the whole point of the value is that NO device recognises
 * it as its own. Device ids are base36 with no separator (see syncClientId), so
 * the colon is what makes that structural rather than lucky — and the device
 * that launched the develop has to adopt this event like any other, because its
 * lane is showing streamed text nobody has persisted.
 */
export const SERVER_DRAFT_ORIGIN = "server:derive"

export interface DraftAdoptContext {
  /** The story this composer belongs to. */
  storyId: string
  /** This tab's id on the channel — events stamped with it are our own echo. */
  selfOrigin: string
  /**
   * The last state the writer produced here that the server has not yet
   * acknowledged, or null when nothing is in flight. Our own write outranks
   * anything the wire can say until it resolves — same rule as
   * useServerSyncedField, for the same reason: an event racing our save must
   * not roll the composer backwards under the writer's hands.
   */
  pending: DraftPayload | null
  /** The version of the draft this device is displaying, or null before any. */
  version: string | null
}

/**
 * Whether an incoming `draft` event should be written into the composer.
 * Versions are ISO-8601 strings, so string order is chronological order; an
 * event no newer than what is on display was already travelling when the row
 * moved, and is turned away no matter what it says.
 */
export function shouldAdoptDraft(
  event: DraftEvent,
  ctx: DraftAdoptContext
): boolean {
  if (event.storyId !== ctx.storyId) return false
  if (event.origin === ctx.selfOrigin) return false
  if (ctx.pending !== null) return false
  if (ctx.version !== null && event.version <= ctx.version) return false
  return true
}
