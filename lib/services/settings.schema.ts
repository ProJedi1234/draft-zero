// lib/services/settings.schema.ts — The app settings request and response
// contract. Isomorphic: no server imports, so a contract package can lift it.
//
// No schema here describes the OpenRouter key. It lives in the environment,
// never in the settings row, and nothing a settings call returns may carry it.
import { z } from "zod"

import {
  ATMOSPHERE_ENGINES,
  IMAGE_CONTEXT_OPTIONS,
  isContextWindow,
  REASONING_EFFORTS,
} from "@/lib/types"

/** Finite and within bounds — NaN and Infinity both fail, which `<`/`>` alone would not. */
function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max
}

/**
 * Any JS number, NaN and Infinity included: z.number() refuses those, and the
 * old action accepted them wherever it had no range rule of its own.
 */
function anyNumber(message: string) {
  return z.custom<number>((value) => typeof value === "number", message)
}

/** A number within [min, max], refused with the old action's one sentence. */
function ranged(min: number, max: number, message: string) {
  return anyNumber(message).refine((v) => inRange(v, min, max), message)
}

/** A whole number within [min, max]. */
function wholeRanged(min: number, max: number, message: string) {
  return anyNumber(message).refine(
    (v) => Number.isInteger(v) && inRange(v, min, max),
    message
  )
}

// Guarded here rather than trusted from the client: the column feeds every
// story created afterwards, and an unknown level would 400 at generation.
const thinking = z.enum(["off", ...REASONING_EFFORTS], {
  error: "Unknown thinking level.",
})

const providerTag = z
  .string({ error: "Provider tag must be text or null." })
  .nullable()
const zdr = z.boolean({ error: "ZDR must be true or false." })

// Blank means "use the built-in default" and is stored as NULL. The id is
// deliberately NOT checked against the catalog: a model that has since left the
// live list should cost a failed call the writer is told about, not a
// settings page that refuses to save.
const optionalModelId = z
  .string({ error: "Model id must be text or null." })
  .nullish()

/** Keys are ordered as the old action checked them; see parseInput. */
export const summarizerSettingsInput = z.object({
  thinking,
  // Bounds are enforced here rather than trusted from the sliders: these three
  // go straight onto the wire, and a bad value is a provider 400.
  temperature: ranged(0, 2, "Temperature must be between 0 and 2."),
  targetWords: ranged(
    25,
    2000,
    "Summary length must be 25–2000 words."
  ).nullable(),
  maxTokens: ranged(64, 8192, "Output cap must be 64–8192 tokens.").nullable(),
  modelId: optionalModelId,
  providerTag,
  zdr,
})

/** Keys are ordered as the old action checked them; see parseInput. */
export const atmosphereSettingsInput = z.object({
  // An unknown engine would fall through the runner's branch to the
  // language-model path: safe, but silent, and billed for the wrong thing.
  engine: z.enum(ATMOSPHERE_ENGINES, { error: "Unknown atmosphere engine." }),
  // Below 0.5 the threshold stops being one; at 1 the picker could be switched
  // off by a slider labelled as caution.
  minConfidence: ranged(0.5, 0.95, "Confidence must be between 0.5 and 0.95."),
  thinking,
  temperature: ranged(0, 2, "Temperature must be between 0 and 2."),
  // The floor is the answer itself: a handful of tokens is enough for one word
  // from a model that does not think first.
  maxTokens: wholeRanged(
    16,
    32_000,
    "Max tokens must be a whole number between 16 and 32000."
  ),
  // One is "after every passage". Zero would be a per-turn call for a question
  // whose input has not changed.
  passagesBetweenChecks: wholeRanged(
    1,
    50,
    "Passages between checks must be a whole number between 1 and 50."
  ),
  modelId: optionalModelId,
  providerTag,
  zdr,
})

/**
 * A partial patch of the settings row. Unknown keys (defaultProfileId,
 * defaultGeneration) are stripped, as the old action ignored them.
 */
export const updateAppSettingsInput = z.object({
  defaultModelId: z
    .string({ error: "Pick a default model." })
    .trim()
    .min(1, "Pick a default model.")
    .optional(),
  defaultThinking: thinking.optional(),
  summarizer: summarizerSettingsInput.optional(),
  atmosphere: atmosphereSettingsInput.optional(),
  requireZdr: z
    .boolean({ error: "Require ZDR must be true or false." })
    .optional(),
  defaultImageModelId: z
    .string({ error: "Image model id must be text or null." })
    .nullable()
    .optional(),
  // The select only offers the ladder, but the ladder is enforced here: this
  // number sizes a billed prompt.
  imageContextTokens: anyNumber("Unsupported image context size.")
    .refine(
      (v) => (IMAGE_CONTEXT_OPTIONS as readonly number[]).includes(v),
      "Unsupported image context size."
    )
    .optional(),
})

/**
 * contextWindow is the only field with a closed value set; the rest were never
 * range-checked, and loreBudget is clamped rather than refused.
 */
export const updateGenerationDefaultsInput = z.object({
  temperature: anyNumber("Temperature must be a number.").optional(),
  topP: anyNumber("Top P must be a number.").optional(),
  contextWindow: anyNumber("Unsupported context window.")
    .refine(isContextWindow, "Unsupported context window.")
    .optional(),
  loreBudget: anyNumber("Lore budget must be a number.").optional(),
  frequencyPenalty: anyNumber("Frequency penalty must be a number.").optional(),
  presencePenalty: anyNumber("Presence penalty must be a number.").optional(),
})

export const verifyOpenRouterKeyInput = z.object({})

/** Settings writes answer with no data; the PWA re-reads through the store. */
export const settingsWriteOutput = z.null()

/**
 * A failed verification is a result, not an error, so it rides the success
 * arm. `message` is one of a fixed set of sentences and never echoes the key.
 */
export const verifyOpenRouterKeyOutput = z.object({
  verified: z.boolean(),
  message: z.string(),
})

export type UpdateAppSettingsInput = z.input<typeof updateAppSettingsInput>
export type UpdateGenerationDefaultsInput = z.input<
  typeof updateGenerationDefaultsInput
>
export type VerifyOpenRouterKeyInput = z.input<typeof verifyOpenRouterKeyInput>
