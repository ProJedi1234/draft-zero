// lib/mcp/model-settings.ts — the generation-settings vocabulary update_story
// and the profile tools share: one field list, one model check, one way to
// name a profile. Declared once so a story and a profile cannot drift apart
// on what "model" or "temperature" accepts.
import { z } from "zod"

import { lookupModel, type ModelCatalog } from "@/lib/generation/models"
import { ToolInputError } from "@/lib/mcp/helpers"
import {
  CONTEXT_WINDOWS,
  isContextWindow,
  LORE_BUDGET_MAX,
  LORE_BUDGET_MIN,
  LORE_BUDGET_STEP,
  REASONING_EFFORTS,
  type ModelProfile,
  type OpenRouterModel,
} from "@/lib/types"

const THINKING_LEVELS = ["off", ...REASONING_EFFORTS] as const

/* -------------------------------------------------------------------------- */
/* Input fields                                                               */
/* -------------------------------------------------------------------------- */

/** What a model is and how it is reached. Required of a profile, never inherited. */
const identityFields = {
  model: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Model id, e.g. "deepseek/deepseek-v4-flash", or "ollama:<name>" for a local model. Checked against the live catalog. If you are unsure of the exact id, ask the writer.'
    ),
  thinking: z
    .enum(THINKING_LEVELS)
    .optional()
    .describe("Reasoning effort. Models that cannot think ignore it."),
  providerTag: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Pin one OpenRouter endpoint by its tag; null routes automatically. Leave it alone unless the writer asks."
    ),
  zdr: z
    .boolean()
    .optional()
    .describe(
      "Route only to zero-data-retention endpoints. The app-wide policy applies on top, so false cannot loosen it."
    ),
}

const temperature = z.number().min(0).max(2)
const topP = z.number().min(0).max(1)
const contextWindow = z
  .number()
  .int()
  .refine(isContextWindow, `Use one of ${CONTEXT_WINDOWS.join(", ")}.`)
const loreBudget = z.number().min(LORE_BUDGET_MIN).max(LORE_BUDGET_MAX)
const penalty = z.number().min(-2).max(2)

const ABOUT = {
  temperature: "0–2.",
  topP: "0–1.",
  contextWindow: `Input tokens the model is shown. One of ${CONTEXT_WINDOWS.join(", ")}.`,
  loreBudget: `Percent of the leftover window lore may claim, ${LORE_BUDGET_MIN}–${LORE_BUDGET_MAX} in steps of ${LORE_BUDGET_STEP}.`,
  frequencyPenalty: "-2–2.",
  presencePenalty: "-2–2.",
}

const INHERIT = "null inherits the app-wide default."

/** A Custom story's settings: concrete values, every one optional in a patch. */
export const storySettingsFields = {
  ...identityFields,
  temperature: temperature.optional().describe(ABOUT.temperature),
  topP: topP.optional().describe(ABOUT.topP),
  contextWindow: contextWindow.optional().describe(ABOUT.contextWindow),
  loreBudget: loreBudget.optional().describe(ABOUT.loreBudget),
  frequencyPenalty: penalty.optional().describe(ABOUT.frequencyPenalty),
  presencePenalty: penalty.optional().describe(ABOUT.presencePenalty),
}

/** A profile's settings: each slider may also be null, meaning "inherit". */
export const profileSettingsFields = {
  ...identityFields,
  temperature: temperature
    .nullable()
    .optional()
    .describe(`${ABOUT.temperature} ${INHERIT}`),
  topP: topP.nullable().optional().describe(`${ABOUT.topP} ${INHERIT}`),
  contextWindow: contextWindow
    .nullable()
    .optional()
    .describe(`${ABOUT.contextWindow} ${INHERIT}`),
  loreBudget: loreBudget
    .nullable()
    .optional()
    .describe(`${ABOUT.loreBudget} ${INHERIT}`),
  frequencyPenalty: penalty
    .nullable()
    .optional()
    .describe(`${ABOUT.frequencyPenalty} ${INHERIT}`),
  presencePenalty: penalty
    .nullable()
    .optional()
    .describe(`${ABOUT.presencePenalty} ${INHERIT}`),
}

/**
 * The fields a call actually passed, with the tool's `model` renamed to the
 * services' `modelId`. Undefined means "leave alone"; null is a real value.
 */
export function toSettingsPatch<T extends { model?: string }>(
  fields: T
): Partial<Omit<T, "model">> & { modelId?: string } {
  const { model, ...rest } = fields
  const patch = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined)
  ) as Partial<Omit<T, "model">>
  return model === undefined ? patch : { ...patch, modelId: model }
}

/** The keys a call passed a value for, in the order it listed them. */
export function passedKeys(fields: Record<string, unknown>): string[] {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
}

/* -------------------------------------------------------------------------- */
/* Models                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Refuses a model id the catalog does not list, naming the nearest ids it
 * does. The app's picker can only offer real models, but an agent's id comes
 * from memory, and a stale or invented one would otherwise fail only at the
 * next generation. Returns the catalog entry, or null when the catalog cannot
 * vouch either way.
 */
export function checkModel(
  catalog: ModelCatalog,
  modelId: string
): OpenRouterModel | null {
  const found = lookupModel(catalog, modelId)
  if (found.status === "found") return found.model
  if (found.status === "unverifiable") return null

  const near = closestModelIds(modelId, found.candidates)
  throw new ToolInputError(
    near.length > 0
      ? `No model "${modelId}" in the catalog. Closest: ${near.join(", ")}. If none of these is right, ask the writer for the exact id.`
      : `No model "${modelId}" in the catalog. Ids look like "author/model"; ask the writer for the exact id.`
  )
}

/**
 * Catalog ids sharing the most of `modelId`'s words, weighted by word length
 * so "deepseek" outranks a shared "v4".
 */
export function closestModelIds(
  modelId: string,
  candidates: OpenRouterModel[],
  limit = 5
): string[] {
  const words = [
    ...new Set(
      modelId
        .toLowerCase()
        .split(/[^a-z0-9.]+/)
        .filter(Boolean)
    ),
  ]
  return candidates
    .map((model) => {
      const id = model.id.toLowerCase()
      const score = words
        .filter((word) => id.includes(word))
        .reduce((sum, word) => sum + word.length, 0)
      return { id: model.id, score, gap: Math.abs(id.length - modelId.length) }
    })
    .filter((match) => match.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.gap - b.gap || a.id.localeCompare(b.id)
    )
    .slice(0, limit)
    .map((match) => match.id)
}

export const modelInfoSchema = z
  .object({
    name: z.string(),
    provider: z.string(),
    contextLength: z.number().int().describe("The model's own window, tokens."),
    pricing: z
      .object({ prompt: z.string(), completion: z.string() })
      .describe("USD per 1M tokens."),
  })
  .nullable()

export function modelInfo(
  model: OpenRouterModel | null
): z.infer<typeof modelInfoSchema> {
  return model
    ? {
        name: model.name,
        provider: model.provider,
        contextLength: model.contextLength,
        pricing: model.pricing,
      }
    : null
}

/** "$0.30/$1.20 per 1M", for a summary line. Null when the price is unknown. */
export function priceLine(model: OpenRouterModel | null): string | null {
  return model
    ? `${model.pricing.prompt}/${model.pricing.completion} per 1M`
    : null
}

/* -------------------------------------------------------------------------- */
/* Profiles                                                                   */
/* -------------------------------------------------------------------------- */

/** The profile `ref` names: an id, or a name compared without case. */
export function findProfile(
  profiles: ModelProfile[],
  ref: string
): ModelProfile {
  const byId = profiles.find((profile) => profile.id === ref)
  if (byId) return byId

  const needle = ref.trim().toLowerCase()
  const named = profiles.filter(
    (profile) => profile.name.trim().toLowerCase() === needle
  )
  if (named.length === 1) return named[0]
  if (named.length > 1) {
    throw new ToolInputError(
      `${named.length} profiles are named "${ref}". Pass one of their ids instead: ${named.map((profile) => profile.id).join(", ")}.`
    )
  }
  throw new ToolInputError(`No profile "${ref}". Call profiles for the list.`)
}
