// lib/generation/atmosphere-prompt.ts — What the tint picker is told, and which
// model is told it by default. Pure data, isomorphic for the same reason
// summary-prompt.ts is: the Settings card that offers to change this is a
// client component, and the runner that reads it imports the database.

import { STORY_TINTS } from "@/lib/story-tint"

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

/**
 * A sentence of mood per tint, for the prompt only.
 *
 * The ids and the order come from STORY_TINTS so the allowed set can never
 * drift from the swatch row, but the glosses live here because they are prompt
 * copy, not palette data: "Lagoon" is what the writer reads under a swatch, and
 * it tells a model nothing about when to choose it. A tint without a gloss
 * falls back to its label rather than disappearing from the list — a missing
 * line here should cost the model some judgement, not cost the writer a colour.
 */
const TINT_MOODS: Record<string, string> = {
  ember: "firelight, forge-heat, blood, ruin, anger held close",
  amber: "dust and lamplight, late afternoon, old money, slow decay",
  sun: "open daylight, harvest, relief, plain and unhidden things",
  verdant: "forest, growth, wet stone, something alive and watching",
  lagoon: "water, cold air, distance, calm that may not hold",
  abyss: "night, deep water, dread, the parts of a story with no floor",
  iris: "magic, dream, the uncanny, ritual, things that should not work",
  rose: "flesh and intimacy, tenderness, sweetness with a wound in it",
}

/**
 * The tint picker's standing brief.
 *
 * Two rules carry the whole feature:
 *
 * - **One word, from the list.** The runner parses strictly and counts anything
 *   else as a failed check, so an answer that explains itself is an answer that
 *   spends money and changes nothing. Saying so twice — the format rule here,
 *   the instruction line in the user turn — is cheap next to the alternative.
 * - **"keep" is the default answer.** This runs after every turn for the life
 *   of a story. A model that reads "choose a tint" as "choose a different tint"
 *   repaints the room on a paragraph of weather, and the writer experiences a
 *   feature they did not ask for as a flicker. The bar is a scene that has
 *   genuinely moved: a new place, a turn in the story's mood, not one dark
 *   sentence inside a bright chapter.
 */
export const ATMOSPHERE_SYSTEM_PROMPT = `you read the mood of a story and name the colour the room it is read in should be.

the available tints are:
{tints}

answer with EXACTLY one word and nothing else: either "keep", or one of the tint ids above. no punctuation, no explanation, no reasoning in your answer.

answer "keep" unless the story has genuinely moved somewhere else — a new place, a lasting change in what the story feels like. one dark paragraph in a bright story is still a bright story, and a scene that is merely tense is not a scene that has changed colour. you are choosing the light the whole story is read in, not lighting this passage. when in doubt, keep.`

/** The system turn with the tint list filled in from STORY_TINTS. */
export function renderAtmosphereSystemPrompt(): string {
  const tints = STORY_TINTS.map(
    (tint) => `- ${tint.id} — ${TINT_MOODS[tint.id] ?? tint.label}`
  ).join("\n")
  return ATMOSPHERE_SYSTEM_PROMPT.replace("{tints}", tints)
}

/**
 * The user turn: what the story is wearing, what it is about, and how it
 * currently reads.
 *
 * The tail goes in raw — no `>` chevrons on player turns (see
 * renderSummaryRequest for the same call), because nothing here answers a move.
 * Memory is included even though the summarizer is told to ignore it: memory is
 * the standing truth about a story's world, and "we are underground now" is
 * exactly the kind of fact the recent prose stops mentioning once it is true.
 */
export function renderAtmosphereRequest(input: {
  /** The tint id the story wears now, or null when it has never had one. */
  current: string | null
  tail: string
  memory: string
}): string {
  const blocks: string[] = []
  const memory = input.memory.trim()
  if (memory !== "") blocks.push(`[Memory]\n${memory}`)
  blocks.push(
    `[Current tint]\n${input.current ?? "(none — this story has never been tinted)"}`
  )
  blocks.push(`[Recent passages]\n${input.tail.trim()}`)
  blocks.push(
    `Answer with one word: "keep", or the id of the tint this story should be read in now.`
  )
  return blocks.join("\n\n")
}
