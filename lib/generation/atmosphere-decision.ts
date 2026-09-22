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
import type { DecisionAnswer, DecisionQuestion } from "./types"

/**
 * The decision model the atmosphere check uses.
 *
 * Pinned to a version rather than to `~typesafe/jev-latest`, and not a
 * setting. There is one decision model in the catalog today, so a picker would
 * be a control with a single entry — and a calibrated classifier is exactly
 * the kind of thing whose thresholds stop meaning what they meant when the
 * weights move underneath them. minConfidence is a number the writer tuned
 * against a specific model, and a story quietly changing colour the morning a
 * new version ships is what a pinned id prevents.
 */
export const ATMOSPHERE_DECISION_MODEL_ID = "typesafe/jev-1.13"

/** The two question keys. Named constants so the ask and the read cannot drift. */
export const STILL_FITS = "still_fits"
export const TINT = "tint"

/**
 * What the model is handed, and nothing more.
 *
 * Deliberately a structured object rather than the prose blocks the other
 * engine sends. The provider's own guidance is that instructions belong in the
 * questions and that accuracy falls as unrelated content grows in the state,
 * so there is no closing "answer with one word" line here — that instruction
 * is carried by the question type itself, which cannot be disobeyed.
 *
 * Memory rides along for the same reason it does in renderAtmosphereRequest:
 * it is the standing truth about a story's world, and "we are underground now"
 * is exactly the kind of fact the recent prose stops repeating once it is true.
 * Omitted when empty rather than sent blank — an empty field is a distractor
 * that says nothing.
 */
export function renderAtmosphereState(input: {
  /** The tint id the story wears now, or null when it has never had one. */
  current: string | null
  tail: string
  memory: string
}): Record<string, unknown> {
  const memory = input.memory.trim()
  return {
    ...(memory === "" ? {} : { memory }),
    ...(input.current === null
      ? {}
      : {
          current_tint: {
            name: input.current,
            means: TINT_MOODS[input.current] ?? input.current,
          },
        }),
    recent_passages: input.tail.trim(),
  }
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
 */
export function renderAtmosphereQuestions(
  tinted: boolean
): Record<string, DecisionQuestion> {
  const tint: DecisionQuestion = {
    type: "choice",
    instructions:
      "Which of these best describes the light this story should be read in — the place it is in, the light it is under, and what it feels like to be there? Judge the story as a whole rather than only its final sentence.",
    // Built from STORY_TINTS so the legal answers and the swatch row are the
    // same eight ids by construction. The prose engine gets the same guarantee
    // from a rendered list the model may ignore; here the keys ARE the answer
    // space, so an off-palette reply is not expressible.
    criteria: Object.fromEntries(
      STORY_TINTS.map((candidate) => [
        candidate.id,
        TINT_MOODS[candidate.id] ?? candidate.label,
      ])
    ),
  }
  if (!tinted) return { [TINT]: tint }
  return {
    [STILL_FITS]: {
      type: "noul",
      instructions:
        "Does the tint the story is currently read in still fit the story as it now reads?",
      criteria: {
        true: "The current tint still describes where this story is, the light it is under, and what it feels like to be there. A single dark scene in a bright story, or one tense exchange, does not make the tint wrong.",
        false:
          "The current tint no longer describes this story — it was set for a place or a mood the story has since left.",
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
 * The two answers, read together, against one threshold.
 *
 * `minConfidence` means one thing — how sure the engine must be before it is
 * allowed to repaint a story — and it is applied to both questions in that
 * sense. Repainting needs the engine to be that sure the old tint is WRONG
 * (1 − P(still fits)) and that sure about the new one. Either doubt keeps the
 * room as it is, which is the direction a decoration should fail in.
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
  if (1 - fits.noul < input.minConfidence) return { kind: "keep" }
  if (choiceConfidence(pick) < input.minConfidence) return { kind: "keep" }
  return painted
}

/**
 * How sure the engine is about its pick, 0–1.
 *
 * `confidence` is the right number and describes the shape of the whole
 * distribution rather than just the winner's share, so a story poised between
 * two moods scores low even when one of them edges ahead. Both it and
 * `probabilities` are optional in the provider's schema, hence the ladder.
 *
 * The final fallback is 1 rather than 0, and that choice is deliberate. A
 * provider that stopped sending confidence would, under a 0 default, silently
 * convert the threshold into "never repaint" — and a tint picker that has
 * quietly stopped working is this feature's worst and least visible failure,
 * because a check that declined and a check that never ran look identical from
 * the outside. Falling open costs a wrong colour somebody can see and fix.
 */
function choiceConfidence(pick: {
  choice: string
  confidence?: number
  probabilities?: Record<string, number>
}): number {
  return pick.confidence ?? pick.probabilities?.[pick.choice] ?? 1
}
