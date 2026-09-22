// tests/atmosphere-decision.test.ts — The decision engine's half of the tint
// picker, as pure functions: what it asks, and what it does with the answer.
//
// The runner's suite (tests/atmosphere-runner.test.ts) owns the gate, the
// breaker and the ledger, and treats both engines as one seam. This file owns
// the part that is genuinely new, which is a threshold rather than a parser.
// Three properties carry it:
//
// 1. THE THRESHOLD ONLY EVER PROTECTS A COLOUR THAT EXISTS. An untinted story
//    is given one at any confidence, because the alternative is a feature that
//    appears not to work — the same failure ATMOSPHERE_FIRST_RULE exists for
//    on the prose side.
// 2. DOUBT KEEPS. Either question falling short of the threshold leaves the
//    room as it is. A decoration fails by not happening.
// 3. AN UNREADABLE ANSWER IS NOT A "KEEP". It has to be distinguishable, or
//    the breaker can never notice an engine that has stopped answering.

import { describe, expect, test } from "bun:test"

import {
  interpretAtmosphereDecision,
  renderAtmosphereQuestions,
  renderAtmosphereState,
  STILL_FITS,
  TINT,
} from "@/lib/generation/atmosphere-decision"
import type { DecisionAnswer } from "@/lib/generation/types"
import { STORY_TINTS } from "@/lib/story-tint"

/** Abyss is the tint every fixture here starts in; ember is the one it moves to. */
function reply(over: {
  fits?: number
  choice?: string
  confidence?: number
  probabilities?: Record<string, number>
  omitFits?: boolean
  omitTint?: boolean
}): Record<string, DecisionAnswer> {
  const answers: Record<string, DecisionAnswer> = {}
  if (!over.omitFits) {
    answers[STILL_FITS] = { type: "noul", noul: over.fits ?? 0.9 }
  }
  if (!over.omitTint) {
    answers[TINT] = {
      type: "choice",
      choice: over.choice ?? "ember",
      ...(over.confidence === undefined ? {} : { confidence: over.confidence }),
      ...(over.probabilities === undefined
        ? {}
        : { probabilities: over.probabilities }),
    }
  }
  return answers
}

const THRESHOLD = { minConfidence: 0.6 }

describe("what it asks", () => {
  test("an untinted story is not offered the abstention at all", () => {
    const questions = renderAtmosphereQuestions(false)
    expect(Object.keys(questions)).toEqual([TINT])
  })

  test("a tinted story is asked both questions, for one round trip", () => {
    const questions = renderAtmosphereQuestions(true)
    expect(Object.keys(questions).sort()).toEqual([STILL_FITS, TINT].sort())
  })

  test("the legal answers are exactly the swatch row", () => {
    const tint = renderAtmosphereQuestions(true)[TINT]
    // Not a list the model may ignore — these keys ARE the answer space, so an
    // off-palette reply is not expressible rather than merely discouraged.
    expect(tint?.type).toBe("choice")
    if (tint?.type !== "choice") throw new Error("unreachable")
    expect(Object.keys(tint.criteria).sort()).toEqual(
      STORY_TINTS.map((candidate) => candidate.id).sort()
    )
    // Every option says what it means. A bare id tells a classifier nothing
    // about when to pick it.
    for (const description of Object.values(tint.criteria)) {
      expect(description.length).toBeGreaterThan(0)
    }
  })
})

describe("what it is handed", () => {
  test("an empty memory is left out rather than sent blank", () => {
    const state = renderAtmosphereState({
      current: "abyss",
      tail: "The lamps went out.",
      memory: "   ",
    })
    expect(state).not.toHaveProperty("memory")
    expect(state.recent_passages).toBe("The lamps went out.")
  })

  test("the current tint travels with its meaning, not as a bare word", () => {
    const state = renderAtmosphereState({
      current: "abyss",
      tail: "x",
      memory: "",
    })
    expect(state.current_tint).toMatchObject({ name: "abyss" })
    expect((state.current_tint as { means: string }).means).toContain("night")
  })

  test("an untinted story is handed no current tint to defend", () => {
    const state = renderAtmosphereState({
      current: null,
      tail: "x",
      memory: "",
    })
    expect(state).not.toHaveProperty("current_tint")
  })
})

describe("a story with no colour yet", () => {
  test("is given one even when the engine is unsure", () => {
    const decided = interpretAtmosphereDecision(
      reply({ confidence: 0.2, omitFits: true }),
      { current: null, ...THRESHOLD }
    )
    // The threshold protects a writer from a colour changing under them, and
    // there is no colour here to change. Never choosing costs the feature.
    expect(decided).toMatchObject({ kind: "paint", id: "ember" })
  })

  test("carries the palette's own hue and strength, not the model's opinion", () => {
    const ember = STORY_TINTS.find((candidate) => candidate.id === "ember")!
    const decided = interpretAtmosphereDecision(reply({ omitFits: true }), {
      current: null,
      ...THRESHOLD,
    })
    expect(decided).toEqual({
      kind: "paint",
      id: "ember",
      hue: ember.hue,
      strength: ember.strength,
    })
  })
})

describe("a story already wearing a colour", () => {
  test("keeps it when the engine says the tint still fits", () => {
    const decided = interpretAtmosphereDecision(reply({ fits: 0.9 }), {
      current: "abyss",
      ...THRESHOLD,
    })
    expect(decided).toEqual({ kind: "keep" })
  })

  test("repaints when the engine is sure on both questions", () => {
    const decided = interpretAtmosphereDecision(
      reply({ fits: 0.1, confidence: 0.8 }),
      { current: "abyss", ...THRESHOLD }
    )
    expect(decided).toMatchObject({ kind: "paint", id: "ember" })
  })

  test("keeps when it is sure the old tint is wrong but unsure of the new one", () => {
    // The case the prose engine cannot express: "this is not abyss, and I do
    // not know what it is" is a real state, and repainting on it is how a room
    // ends up flickering through a scene that is between two moods.
    const decided = interpretAtmosphereDecision(
      reply({ fits: 0.05, confidence: 0.4 }),
      { current: "abyss", ...THRESHOLD }
    )
    expect(decided).toEqual({ kind: "keep" })
  })

  test("keeps when the old tint is only mildly doubted", () => {
    // 1 − 0.55 is below the 0.6 threshold, so this is a passing dark scene
    // rather than a story that has moved.
    const decided = interpretAtmosphereDecision(
      reply({ fits: 0.55, confidence: 0.95 }),
      { current: "abyss", ...THRESHOLD }
    )
    expect(decided).toEqual({ kind: "keep" })
  })

  test("the threshold is the writer's, and moving it changes the answer", () => {
    const answer = reply({ fits: 0.3, confidence: 0.65 })
    expect(
      interpretAtmosphereDecision(answer, {
        current: "abyss",
        minConfidence: 0.6,
      })
    ).toMatchObject({ kind: "paint" })
    expect(
      interpretAtmosphereDecision(answer, {
        current: "abyss",
        minConfidence: 0.8,
      })
    ).toEqual({ kind: "keep" })
  })

  test("naming the colour it already wears is a keep, not a repaint", () => {
    // Short-circuited before the threshold: writing the tint a story already
    // has would push a change event at every open device to say nothing
    // changed.
    const decided = interpretAtmosphereDecision(
      reply({ fits: 0.01, choice: "abyss", confidence: 0.99 }),
      { current: "abyss", ...THRESHOLD }
    )
    expect(decided).toEqual({ kind: "keep" })
  })
})

describe("confidence the provider did not send", () => {
  test("falls back to the winner's own probability", () => {
    const decided = interpretAtmosphereDecision(
      reply({ fits: 0.1, probabilities: { ember: 0.45, abyss: 0.55 } }),
      { current: "abyss", ...THRESHOLD }
    )
    expect(decided).toEqual({ kind: "keep" })
  })

  test("falls OPEN when neither number arrives", () => {
    // Deliberately the permissive direction. A missing field defaulting to
    // zero would silently convert the threshold into "never repaint", and a
    // tint picker that has quietly stopped is indistinguishable from one that
    // is merely content — the failure this feature is least able to surface.
    const decided = interpretAtmosphereDecision(reply({ fits: 0.1 }), {
      current: "abyss",
      ...THRESHOLD,
    })
    expect(decided).toMatchObject({ kind: "paint", id: "ember" })
  })
})

describe("an answer that cannot be used", () => {
  test("a missing tint answer is unreadable, not a keep", () => {
    const decided = interpretAtmosphereDecision(reply({ omitTint: true }), {
      current: "abyss",
      ...THRESHOLD,
    })
    expect(decided.kind).toBe("unreadable")
  })

  test("a tint outside the palette is unreadable", () => {
    // Only reachable if the provider answered outside the criteria it was
    // sent. What survives here is interpolated into a stylesheet.
    const decided = interpretAtmosphereDecision(
      reply({ fits: 0.1, choice: "octarine", confidence: 0.99 }),
      { current: "abyss", ...THRESHOLD }
    )
    expect(decided.kind).toBe("unreadable")
  })

  test("a missing fit answer on a tinted story is unreadable", () => {
    const decided = interpretAtmosphereDecision(reply({ omitFits: true }), {
      current: "abyss",
      ...THRESHOLD,
    })
    expect(decided.kind).toBe("unreadable")
  })

  test("an answer of the wrong type is unreadable rather than coerced", () => {
    const decided = interpretAtmosphereDecision(
      {
        [TINT]: { type: "score", score: 2 },
        [STILL_FITS]: { type: "noul", noul: 0.1 },
      },
      { current: "abyss", ...THRESHOLD }
    )
    expect(decided.kind).toBe("unreadable")
  })
})
