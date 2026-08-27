// lib/generation/atmosphere-prompt.ts — Which model chooses a story's tint when
// Settings has not been told otherwise. Isomorphic for the same reason
// summary-prompt.ts is: the Settings card that offers to change this is a
// client component, and the runner that reads it imports the database.

/**
 * What picks the tint by default.
 *
 * The same choice the summarizer makes and for the same reasons — this runs
 * after turns, forever, for a one-word answer, so cheap and fast is the whole
 * specification. Its own constant rather than a shared one because the two jobs
 * are free to diverge: the day a better tiny model exists for reading mood, it
 * should be able to move here without moving the summarizer too.
 */
export const DEFAULT_ATMOSPHERE_MODEL_ID = "~anthropic/claude-haiku-latest"
