// lib/services/settings.ts — App settings writes and the key check, callable
// from a server action, a route handler or an MCP tool alike.
import "server-only"

import { OpenRouterError } from "@openrouter/sdk/models/errors"
import { eq } from "drizzle-orm"

import { getDb } from "@/lib/db/client"
import { getAppSettings } from "@/lib/db/queries"
import { appSettings } from "@/lib/db/schema"
import { clearAtmosphereBreaker } from "@/lib/generation/atmosphere"
import { resolveOpenRouterKey } from "@/lib/generation/key"
import { fetchKeyMetadata } from "@/lib/generation/key-check"
import { commitChange } from "@/lib/services/commit"
import type { Service } from "@/lib/services/context"
import { ok, parseInput } from "@/lib/services/result"
import {
  updateAppSettingsInput,
  updateGenerationDefaultsInput,
  verifyOpenRouterKeyInput,
  type UpdateAppSettingsInput,
  type UpdateGenerationDefaultsInput,
  type VerifyOpenRouterKeyInput,
} from "@/lib/services/settings.schema"
import { clampLoreBudget } from "@/lib/types"

/**
 * Patches the single settings row. Every rule lives in the schema, in the
 * order the fields are checked, so a bad patch writes nothing.
 *
 * `ctx` is accepted for the uniform signature but unused: settings changes
 * publish a scope-null change event, which carries no origin today.
 */
export const updateAppSettings: Service<UpdateAppSettingsInput> = async (
  raw
) => {
  const parsed = parseInput(updateAppSettingsInput, raw)
  if (!parsed.ok) return parsed
  const patch = parsed.data

  const values: Partial<typeof appSettings.$inferInsert> = {}
  if (patch.defaultModelId !== undefined) {
    values.defaultModelId = patch.defaultModelId
  }
  if (patch.defaultThinking !== undefined) {
    values.defaultThinking = patch.defaultThinking
  }
  if (patch.summarizer !== undefined) {
    const { modelId, thinking, providerTag, zdr, temperature } =
      patch.summarizer
    const { targetWords, maxTokens } = patch.summarizer
    // Blank means "use the built-in default" — stored as NULL so the install
    // keeps following whatever the app thinks is right rather than freezing
    // today's answer.
    const trimmed = modelId?.trim() ?? ""
    values.summaryModelId = trimmed === "" ? null : trimmed
    values.summaryThinking = thinking
    values.summaryProviderTag = providerTag
    values.summaryZdr = zdr
    values.summaryTemperature = temperature
    values.summaryTargetWords = targetWords
    values.summaryMaxTokens = maxTokens
  }
  if (patch.atmosphere !== undefined) {
    const {
      engine,
      minConfidence,
      modelId,
      thinking,
      providerTag,
      zdr,
      temperature,
      maxTokens,
      passagesBetweenChecks,
    } = patch.atmosphere
    const trimmed = modelId?.trim() ?? ""
    values.atmosphereModelId = trimmed === "" ? null : trimmed
    values.atmosphereEngine = engine
    values.atmosphereMinConfidence = minConfidence
    values.atmosphereThinking = thinking
    values.atmosphereProviderTag = providerTag
    values.atmosphereZdr = zdr
    values.atmosphereTemperature = temperature
    values.atmosphereMaxTokens = maxTokens
    values.atmospherePassagesBetweenChecks = passagesBetweenChecks
    // A bundle that has been edited is a different bundle, and the breaker's
    // three strikes were against the old one. Without this, the Settings
    // change that FIXES a broken picker cannot revive a story that already
    // gave up on it — only a server restart could.
    clearAtmosphereBreaker()
  }
  if (patch.requireZdr !== undefined) {
    values.requireZdr = patch.requireZdr
  }
  if (patch.defaultImageModelId !== undefined) {
    // Blank clears back to "the catalog's first eligible entry". Deliberately
    // NOT checked against the catalog, same reasoning as the summarizer model.
    const trimmed = patch.defaultImageModelId?.trim() ?? ""
    values.defaultImageModelId = trimmed === "" ? null : trimmed
  }
  if (patch.imageContextTokens !== undefined) {
    values.imageContextTokens = patch.imageContextTokens
  }

  // Ensures the single settings row exists before patching it.
  await getAppSettings()

  if (Object.keys(values).length > 0) {
    const db = await getDb()
    await db.update(appSettings).set(values).where(eq(appSettings.id, 1))
  }

  commitChange(null, ["app-settings"])
  return ok(null)
}

/**
 * Patches the shared generation defaults — the values every profile falls back
 * to for the sliders it does not override.
 *
 * Separate from updateAppSettings rather than folded into it: this is the one
 * write whose blast radius is every profile that never disagreed, and a
 * partial patch of six fields reads better than a nested object in a partial
 * patch of the whole settings row.
 *
 * contextWindow is guarded exactly as on a story (updateGenerationSettings):
 * it is the only field with a closed value set, and an off-ladder stop would
 * render as a blank slider readout everywhere it is inherited.
 */
export const updateGenerationDefaults: Service<
  UpdateGenerationDefaultsInput
> = async (raw) => {
  const parsed = parseInput(updateGenerationDefaultsInput, raw)
  if (!parsed.ok) return parsed
  const patch = parsed.data

  const values: Partial<typeof appSettings.$inferInsert> = {}
  if (patch.temperature !== undefined)
    values.defaultTemperature = patch.temperature
  if (patch.topP !== undefined) values.defaultTopP = patch.topP
  if (patch.contextWindow !== undefined) {
    values.defaultContextWindow = patch.contextWindow
  }
  if (patch.loreBudget !== undefined) {
    values.defaultLoreBudget = clampLoreBudget(patch.loreBudget)
  }
  if (patch.frequencyPenalty !== undefined)
    values.defaultFrequencyPenalty = patch.frequencyPenalty
  if (patch.presencePenalty !== undefined)
    values.defaultPresencePenalty = patch.presencePenalty

  if (Object.keys(values).length === 0) return ok(null)

  // Ensures the single settings row exists before patching it.
  await getAppSettings()
  const db = await getDb()
  await db.update(appSettings).set(values).where(eq(appSettings.id, 1))

  // Null, not a story id: the defaults reach every profile, so every device —
  // including ones sitting on a story whose profile inherits — has to hear it.
  commitChange(null, ["app-settings"])
  return ok(null)
}

/**
 * Real key check against OpenRouter, using the single shared key from
 * OPENROUTER_API_KEY. A failed verification is a result, not an error, so
 * every outcome is a success carrying `verified` and a fixed sentence.
 */
export const verifyOpenRouterKey: Service<
  VerifyOpenRouterKeyInput,
  { verified: boolean; message: string }
> = async (raw) => {
  const parsed = parseInput(verifyOpenRouterKeyInput, raw)
  if (!parsed.ok) return parsed

  const key = resolveOpenRouterKey()
  if (!key) {
    return ok({
      verified: false,
      message: "OPENROUTER_API_KEY is not configured.",
    })
  }
  try {
    await fetchKeyMetadata(key)
    return ok({ verified: true, message: "Key verified with OpenRouter." })
  } catch (err) {
    if (err instanceof OpenRouterError && err.statusCode === 401) {
      return ok({ verified: false, message: "OpenRouter rejected this key." })
    }
    return ok({
      verified: false,
      message: "Couldn't reach OpenRouter. Try again.",
    })
  }
}
