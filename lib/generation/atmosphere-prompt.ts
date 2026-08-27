// lib/generation/atmosphere-prompt.ts — What the tint picker is told, and which
// model is told it by default. Pure data, isomorphic for the same reason
// summary-prompt.ts is: the Settings card that offers to change this is a
// client component, and the runner that reads it imports the database.

import { STORY_TINTS } from "@/lib/story-tint"

/**
 * What picks the tint by default.
 *
 * Cheap and fast is most of the specification — this runs after turns, forever,
 * for a one-word answer — and it diverges from the summarizer's default on the
 * rest of it. Both were Haiku until the two jobs were measured against the same
 * stories: reading a scene's mood is a classification a small fast model does
 * as well as a careful one, and this one answers in about a third of the time
 * at a fraction of the price. Its own constant precisely so the two can differ.
 */
export const DEFAULT_ATMOSPHERE_MODEL_ID = "~deepseek/deepseek-v4-flash-latest"

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
 * - **The abstention exists, and it is narrow.** This runs after every turn for
 *   the life of a story, so a model that reads "choose a tint" as "choose a
 *   different tint" repaints the room on a paragraph of weather and the writer
 *   experiences a feature they did not ask for as a flicker. What holds it
 *   steady is a rule about FIT rather than one about change — see
 *   ATMOSPHERE_KEEP_RULE for why that distinction cost a real session.
 *
 * Which is why there are two closing rules rather than one. On an UNTINTED
 * story "keep" means "leave the room grey", and a model told to prefer keeping
 * will say it about a story it has been handed no colour for — a feature that
 * appears not to work at all. Observed, not theorised: three consecutive checks
 * on an untinted story answered keep, including one on a turn that moved the
 * scene to evening. So the abstention is removed from the one case where it has
 * nothing to protect. Choosing a colour that turns out slightly wrong costs a
 * writer one press of a swatch; never choosing costs them the feature.
 */
const ATMOSPHERE_RULES = `you read the mood of a story and name the colour the room it is read in should be.

the available tints are:
{tints}

answer with EXACTLY one word and nothing else: {answers}. no punctuation, no explanation, no reasoning in your answer.`

/**
 * Appended when the story already wears a colour.
 *
 * Asks whether the tint FITS, not whether the story has moved, and the
 * difference is not academic. The first version asked about movement and was
 * observed keeping a story on abyss — night, deep water, dread — through
 * several passages of blazing white sand under a climbing morning sun. It was
 * answering correctly: nothing had moved, the beach had been there all along.
 * A tint can be wrong without anything having changed — it was set by a hand,
 * or by an earlier check, or by a scene the story has long since left — and a
 * question about change can never notice that, so the room stays wrong forever
 * and the writer concludes the feature is broken.
 */
const ATMOSPHERE_KEEP_RULE = `you are told the tint the story is read in now. answer "keep" only if that tint still fits the story as it currently reads — the place it is in, the light it is under, what it feels like to be there. if it does not fit, answer with the tint that does.

hold steady through a passing moment: one dark scene in a bright story, or a single tense exchange, is not a reason to repaint, and you are choosing the light the whole story is read in rather than lighting the latest passage. but a tint that no longer describes this story is worth correcting however long it has been wrong — never keep a colour merely because it is the one already there.`

/** Appended when it does not. */
const ATMOSPHERE_FIRST_RULE = `this story has no colour yet, so you must choose one — "keep" is not an answer here. pick the tint that best fits what the story has felt like so far. you are choosing the light the whole story is read in, not lighting the latest passage, so read for the setting and the mood that have lasted rather than the mood of the last sentence. if several fit, choose the closest one anyway.`

export const ATMOSPHERE_SYSTEM_PROMPT = `${ATMOSPHERE_RULES}\n\n${ATMOSPHERE_KEEP_RULE}`

/**
 * The system turn with the tint list filled in from STORY_TINTS.
 *
 * `tinted` is what picks between the two closing rules — see the note above on
 * why an untinted story is not allowed to abstain.
 */
export function renderAtmosphereSystemPrompt(tinted: boolean): string {
  const tints = STORY_TINTS.map(
    (tint) => `- ${tint.id} — ${TINT_MOODS[tint.id] ?? tint.label}`
  ).join("\n")
  const answers = tinted
    ? `either "keep", or one of the tint ids above`
    : `one of the tint ids above`
  return `${ATMOSPHERE_RULES.replace("{tints}", tints).replace("{answers}", answers)}\n\n${tinted ? ATMOSPHERE_KEEP_RULE : ATMOSPHERE_FIRST_RULE}`
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
  // The gloss rides along with the id, so "does this still fit" is answerable
  // from the line itself. Without it the model has to carry the meaning down
  // from the list in the system turn and match it against a bare word, which
  // is a second thing to get right in a job that is only allowed one word.
  const currentMood =
    input.current === null ? null : (TINT_MOODS[input.current] ?? null)
  blocks.push(
    `[Current tint]\n${
      input.current === null
        ? "(none — this story has never been tinted)"
        : currentMood === null
          ? input.current
          : `${input.current} — ${currentMood}`
    }`
  )
  blocks.push(`[Recent passages]\n${input.tail.trim()}`)
  blocks.push(
    input.current === null
      ? `Answer with one word: the id of the tint this story should be read in. Do not answer "keep".`
      : `Answer with one word: "keep", or the id of the tint this story should be read in now.`
  )
  return blocks.join("\n\n")
}
