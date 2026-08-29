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
