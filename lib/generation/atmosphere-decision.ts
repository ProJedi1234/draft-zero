// lib/generation/atmosphere-decision.ts — The tint question as a decision model
// hears it, and what its answers mean. Pure and isomorphic, for the same reason
// atmosphere-prompt.ts is: the Settings card names the model and the runner
// imports the database.
//
// This is the second engine for one job, not a second job. Its sibling states
// the question in prose and reads one word back; this one states it as two
// typed questions and reads two probabilities back. Everything around them —
// the gate, the breaker, the ledger row, the write — is shared, and lives in
// atmosphere.ts.
//
// The two questions are the whole design. The prose engine has to fold "has
// this story moved on from its colour" and "what colour is it now" into a
// single list where `keep` sits alongside eight tints, which is a list of two
// different kinds of thing and the source of both its documented failures. A
// decision model answers a set of questions in ONE round trip, so the fold is
// unnecessary here: ask whether the current tint still fits, ask which tint
// fits best, and read them together.

import { STORY_TINTS } from "@/lib/story-tint"

import { TINT_MOODS } from "./atmosphere-prompt"
import type {
  DecisionAnswer,
  DecisionGuidance,
  DecisionQuestion,
} from "./types"

/**
 * The decision model the atmosphere check uses until the writer picks one.
 *
 * Pinned to a version rather than to `~typesafe/jev-latest`: a calibrated
 * classifier's thresholds stop meaning what they meant when the weights move
 * underneath them, and minConfidence is a number the writer tuned against a
 * specific model.
 */
export const DEFAULT_ATMOSPHERE_DECISION_MODEL_ID = "typesafe/jev-1.13"

/** The two question keys. Named constants so the ask and the read cannot drift. */
export const STILL_FITS = "still_fits"
export const TINT = "tint"

type TintCriterion = {
  /** The places, light and feelings the tint covers, named plainly. */
  what: string
  /** The neighbours it is confused with, and which tint each belongs to. */
  not_for: string
  /** Short passages that belong here, chosen to sit near a boundary. */
  examples: readonly string[]
}

/**
 * What each tint means, for Jev, which matches words literally. TINT_MOODS is
 * imagery for an LLM, and its rose ("flesh ... a wound") reads like a fight
 * scene to a literal reader. Keep the two in step.
 */
export const TINT_CRITERIA: Record<string, TintCriterion> = {
  ember: {
    what: "Fire and hostility. Flames, forges, burning buildings, battles, someone trying to hurt an enemy, blood spilled in a real fight, rage, revenge, a confrontation about to turn violent.",
    not_for:
      "A warm hearth or a candlelit room where nothing is threatened is amber. Fear of something unseen, or horror that creeps rather than strikes, is abyss. Bruises, sparring or rough play between people who like each other is not a fight, so judge that scene by its place and its mood instead.",
    examples: [
      "Smoke rolls over the walls as the gate gives way and the raiders pour in.",
      "He slams the tankard down and reaches for the knife at his belt.",
      "Steel rings across the sunlit market as the duel begins.",
    ],
  },
  amber: {
    what: "Warm, still and old. Lamplight and candlelight, a tavern or a study in the evening, dust in late-afternoon light, memories and nostalgia, old money, old houses, things slowly running down.",
    not_for:
      "Open daylight, cheer and relief are sun. Fire that burns or threatens is ember.",
    examples: [
      "The innkeeper trims the lamp and pours the last of the wine while the rain goes on outside.",
      "Dust drifts through the long gallery where portraits of dead heirs line the walls.",
      "She reads his old letters again by the candle, though she knows every word.",
      "He winks at you over the ledger, then goes back to counting the day's takings by lamplight.",
    ],
  },
  sun: {
    what: "Bright, open and safe. Daylight outdoors, fields, markets, beaches and roads on a clear day, harvest and celebration, relief after danger, honest people and plain dealings.",
    not_for:
      "A bright place where something violent is happening is ember. A bright place where something frightening is happening is abyss. Lamplight and evenings indoors are amber.",
    examples: [
      "The caravan crosses the white dunes under a climbing morning sun.",
      "The whole village turns out for the harvest fair, and children run between the stalls.",
      "When the siege lifts, the survivors walk out through the gate into the sunlight.",
      "She bumps your shoulder as you load the cart, grins, and goes back to haggling with the farmer.",
    ],
  },
  verdant: {
    what: "Living, growing places. Forests, jungles, gardens, moss and wet stone, rain on leaves, healing and new growth, wild nature that feels alive and aware of you.",
    not_for:
      "Open farmland or a sunny meadow where the feeling is ease is sun. A forest that feels enchanted or unreal is iris. A forest at night that frightens is abyss.",
    examples: [
      "Ferns brush your knees as the path narrows between trunks furred with moss.",
      "Vines thick as rope have burst the greenhouse panes and crawled over everything.",
      "Rain drips from the canopy onto the stones of the ruined shrine.",
    ],
  },
  lagoon: {
    what: "Cool water and open air. The sea, lakes and rivers, rain, snow and ice, cold wind, sailing, long distances, loneliness, a calm that may not last.",
    not_for:
      "Deep or dark water that frightens, the sea floor, drowning, or whatever lives beneath is abyss. A warm, sunny beach day is sun.",
    examples: [
      "The boat drifts across the grey lake while the mist closes in behind it.",
      "Snow falls on the empty harbour, and the ships creak at their moorings.",
      "Night on the lake is still and silver, and nobody speaks.",
    ],
  },
  abyss: {
    what: "Darkness and dread. Night, caves, the deep sea, empty space, horror, despair, grief with no bottom, a threat that cannot be seen or understood.",
    not_for:
      "A calm or peaceful night is lagoon or amber. An open fight or burning anger is ember. Magic or dreams that feel wondrous rather than frightening are iris.",
    examples: [
      "Your torch gutters, and something far down the tunnel breathes in the dark.",
      "A shape moves under the ice, far too large to be a fish.",
      "The sand heaves, and something vast rises out of the dunes and blots out the sun.",
    ],
  },
  iris: {
    what: "Magic and the unreal. Spells, rituals, visions, dreams, gods and spirits, portals, time going wrong, anything that should not be possible.",
    not_for:
      "A story where magic is ordinary background while the scene is about something else, such as a battle (ember) or a love scene (rose). Plain fear of the dark is abyss.",
    examples: [
      "The circle of candles flares violet as the last word of the rite is spoken.",
      "The forest paths rearrange themselves whenever you look away.",
      "You wake in your own bed, but the window opens onto a sea that was not there yesterday.",
    ],
  },
  rose: {
    what: "Love and closeness as the point of the scene. Romance, desire, a kiss, lovers alone together, tenderness between two people, family warmth, comfort after hurt, sweetness with sadness in it, a love that costs something.",
    not_for:
      "Flirting, teasing or attraction while the characters are busy with something else, such as travelling, working, eating or exploring, takes the tint of the place: sun for daylight and open air, amber for lamplight and evenings indoors. A fight between enemies is ember, however close the people are.",
    examples: [
      "By the dying fire she rests her head on his shoulder, and neither of them moves.",
      "Still breathless from sparring, she pulls him down onto the mat and kisses him.",
      "Her mother braids her hair one last time before the wedding.",
    ],
  },
}

/**
 * A tint's criteria, falling back to the prose gloss and then the label.
 *
 * A tint added to the swatch row without criteria here should cost the model
 * some judgement, not cost the writer a colour.
 */
function tintGuidance(id: string, label: string): DecisionGuidance {
  return TINT_CRITERIA[id] ?? TINT_MOODS[id] ?? label
}

/**
 * What a tint covers and where its boundaries are, for the fit question. The
 * boundaries matter as much as the meaning: without them the fit question
 * holds a tint the choice question has already ruled out.
 */
function tintDefinition(id: string): string {
  const criterion = TINT_CRITERIA[id]
  if (criterion === undefined) return TINT_MOODS[id] ?? id
  return `${criterion.what} Not ${id}: ${criterion.not_for}`
}

/**
 * What the model is handed, and nothing more.
 *
 * Deliberately a structured object rather than the prose blocks the other
 * engine sends. The provider's own guidance is that instructions belong in the
 * questions and that accuracy falls as unrelated content grows in the state,
 * so there is no closing "answer with one word" line here — that instruction
 * is carried by the question type itself, which cannot be disobeyed. The
 * current tint lives in the fit question for the same reason.
 *
 * Memory rides along for the same reason it does in renderAtmosphereRequest:
 * it is the standing truth about a story's world, and "we are underground now"
 * is exactly the kind of fact the recent prose stops repeating once it is true.
 * Omitted when empty rather than sent blank — an empty field is a distractor
 * that says nothing.
 */
export function renderAtmosphereState(input: {
  tail: string
  memory: string
}): Record<string, unknown> {
  const memory = input.memory.trim()
  return {
    ...(memory === "" ? {} : { memory }),
    recent_passages: input.tail.trim(),
  }
}

/** Conservative characters per token, so an estimate errs toward fitting. */
const CHARS_PER_TOKEN = 3.5
/** Room for the provider's own framing around the state and the question. */
const PROMPT_OVERHEAD_TOKENS = 64

const estimateTokens = (value: unknown) =>
  Math.ceil(JSON.stringify(value).length / CHARS_PER_TOKEN)

/**
 * The state, cut down until the state plus its largest question fits a
 * per-prompt window. A local decision model scores every question as its own
 * prompt and refuses one over its num_ctx outright, so the oldest prose goes
 * first, then the memory. With room to spare the state comes back whole.
 */
export function fitAtmosphereState(input: {
  tail: string
  memory: string
  questions: Record<string, DecisionQuestion>
  windowTokens: number
}): Record<string, unknown> {
  const largestQuestion = Math.max(
    0,
    ...Object.values(input.questions).map(estimateTokens)
  )
  const budget = input.windowTokens - largestQuestion - PROMPT_OVERHEAD_TOKENS
  let tail = input.tail.trim()
  let memory = input.memory.trim()
  const fits = () =>
    estimateTokens(renderAtmosphereState({ tail, memory })) <= budget
  while (!fits() && tail.length > 0) {
    const words = tail.split(/\s+/)
    tail = words.slice(Math.ceil(words.length / 10)).join(" ")
  }
  while (!fits() && memory.length > 0) {
    memory = memory.slice(0, Math.floor(memory.length * 0.9)).trim()
  }
  return renderAtmosphereState({ tail, memory })
}

/**
 * The questions, which are one or two depending on whether there is a colour
 * to defend.
 *
 * An untinted story is asked only which tint fits. The `still_fits` question
 * would be meaningless — there is nothing to still fit — and asking it is how
 * the prose engine ended up answering "keep" about a story it had been handed
 * no colour for, three checks running. Here the case cannot arise, because the
 * abstention is not in the question set at all.
 *
 * The fit question names the current tint and spells out its meaning and its
 * boundaries in the instructions. Jev answers indirection ("the tint in
 * current_tint") less reliably than a direct question, per TypeSafe's notes on
 * Jev 1.13.
 */
export function renderAtmosphereQuestions(
  /** The tint id the story wears now, or null when it has never had one. */
  current: string | null
): Record<string, DecisionQuestion> {
  const tint: DecisionQuestion = {
    type: "choice",
    // Jev takes the question literally, so the rule for a place and a feeling
    // that disagree has to be stated rather than left to judgement.
    instructions:
      "Choose the tint for how this story feels to be in right now. Judge the feeling that runs through the recent passages as a whole, not a single line or exchange. When the place and the feeling point to different tints, choose by the feeling: a fight at noon is ember, not sun. When the feeling is mild, or is passing flirtation during something else, choose by the place and its light.",
    // Built from STORY_TINTS so the legal answers and the swatch row are the
    // same eight ids by construction. The prose engine gets the same guarantee
    // from a rendered list the model may ignore; here the keys ARE the answer
    // space, so an off-palette reply is not expressible.
    criteria: Object.fromEntries(
      STORY_TINTS.map((candidate) => [
        candidate.id,
        tintGuidance(candidate.id, candidate.label),
      ])
    ),
  }
  if (current === null) return { [TINT]: tint }
  return {
    [STILL_FITS]: {
      type: "noul",
      instructions: `This story is tinted ${current}. ${current} means: ${tintDefinition(current)} Do the recent passages, taken as a whole, still feel like ${current}?`,
      criteria: {
        true: `Most of the recent passages still feel like ${current}, even if one scene or exchange feels different.`,
        false: `The story has moved to a different place or feeling, and ${current} no longer describes most of the recent passages.`,
      },
    },
    [TINT]: tint,
  }
}

/** A tint to paint, an instruction to leave the story alone, or a reply we can't use. */
export type AtmosphereDecision =
  | { kind: "keep" }
  | { kind: "paint"; id: string; hue: number; strength: number }
  | { kind: "unreadable"; why: string }

/**
 * Fit score at which the current tint vetoes a repaint. Fixed, not the slider,
 * because a higher slider must mean steadier colours. Calibrated on the pinned
 * Jev 1.13: passing moments scored 0.67 and up, moved-on stories 0.54 or less.
 */
export const STILL_FITS_VETO = 0.6

/**
 * The two answers, read together.
 *
 * The fit question holds a colour: when it is at least STILL_FITS_VETO sure the
 * current tint still fits, the story keeps it whatever the pick says. That is
 * what carries a story through a passing moment, because the pick question
 * tends to chase the last passage. Otherwise a pick at least `minConfidence`
 * sure repaints.
 *
 * The rule used to demand the reverse, that the engine be sure the old tint
 * was WRONG. On a scene that has moved on but shares something with the old
 * colour, the fit question settles between 0.4 and 0.55, so that rule kept the
 * old colour indefinitely.
 *
 * An untinted story bypasses the threshold entirely and takes the pick at
 * whatever confidence it arrived with. That is not an oversight and it mirrors
 * ATMOSPHERE_FIRST_RULE. The threshold protects a writer from a colour
 * changing under them, and a story with no colour has nothing to protect —
 * while a first choice that is slightly wrong costs one press of a swatch, and
 * never choosing costs the whole feature.
 */
export function interpretAtmosphereDecision(
  answers: Record<string, DecisionAnswer>,
  input: { current: string | null; minConfidence: number }
): AtmosphereDecision {
  const pick = answers[TINT]
  if (pick === undefined || pick.type !== "choice") {
    return { kind: "unreadable", why: "no tint answer" }
  }
  const tint = STORY_TINTS.find((candidate) => candidate.id === pick.choice)
  // Only reachable if the provider answered outside the criteria it was sent,
  // which would be a contract violation rather than a bad judgement. Treated
  // as a failed check so the breaker can eventually stop paying for it.
  if (tint === undefined) {
    return { kind: "unreadable", why: `unknown tint "${pick.choice}"` }
  }
  const painted = {
    kind: "paint" as const,
    id: tint.id,
    hue: tint.hue,
    strength: tint.strength,
  }

  if (input.current === null) return painted
  if (pick.choice === input.current) return { kind: "keep" }

  const fits = answers[STILL_FITS]
  if (fits === undefined || fits.type !== "noul") {
    return { kind: "unreadable", why: "no fit answer" }
  }
  if (fits.noul >= STILL_FITS_VETO) return { kind: "keep" }
  if (choiceConfidence(pick) < input.minConfidence) return { kind: "keep" }
  return painted
}

/**
 * How sure the engine is about its pick, 0–1.
 *
 * `confidence` is the only field that answers this. It reports how peaked the
 * distribution is, so a story poised between two moods scores low even when
 * one of them edges ahead. The winner's own share in `probabilities` measures
 * something else and is deliberately not consulted — spread over eight tints
 * it lands under every threshold the writer can set, so reading it as
 * confidence would turn a high setting into "never repaint".
 *
 * `confidence` is optional in the provider's schema, so a missing one falls
 * through to 1 rather than 0, and that direction is deliberate. A provider
 * that stopped sending it would, under a 0 default, silently convert the
 * threshold into "never repaint" — and a tint picker that has quietly stopped
 * working is this feature's worst and least visible failure, because a check
 * that declined and a check that never ran look identical from the outside.
 * Falling open costs a wrong colour somebody can see and fix.
 */
function choiceConfidence(pick: { confidence?: number }): number {
  return pick.confidence ?? 1
}
