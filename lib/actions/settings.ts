"use server"

import { OpenRouter } from "@openrouter/sdk"
import { OpenRouterError } from "@openrouter/sdk/models/errors"
import { eq } from "drizzle-orm"

import { commitChange } from "@/lib/actions/commit"
import { getDb } from "@/lib/db/client"
import { getAppSettings } from "@/lib/db/queries"
import { appSettings } from "@/lib/db/schema"
import { resolveOpenRouterKey } from "@/lib/generation/key"
import {
  clampLoreBudget,
  isContextWindow,
  REASONING_EFFORTS,
  type ActionResult,
  type AppSettings,
  type GenerationDefaults,
} from "@/lib/types"

export async function updateAppSettings(
  patch: Partial<AppSettings>
): Promise<ActionResult> {
  const values: Partial<typeof appSettings.$inferInsert> = {}
  if (patch.defaultModelId !== undefined) {
    const modelId = patch.defaultModelId.trim()
    if (modelId === "") return { ok: false, error: "Pick a default model." }
    values.defaultModelId = modelId
  }
  if (patch.defaultThinking !== undefined) {
    // Guarded here rather than trusted from the client: the column feeds every
    // story created afterwards, and an unknown level would 400 at generation.
    const thinking = patch.defaultThinking
    if (thinking !== "off" && !REASONING_EFFORTS.includes(thinking)) {
      return { ok: false, error: "Unknown thinking level." }
    }
    values.defaultThinking = thinking
  }
  if (patch.summarizer !== undefined) {
    const { modelId, thinking, providerTag, zdr } = patch.summarizer
    // Guarded here rather than trusted from the client, exactly as
    // defaultThinking is above: an unknown level 400s at generation, and the
    // failure would reach the writer as a summarizer that has mysteriously
    // stopped working.
    if (thinking !== "off" && !REASONING_EFFORTS.includes(thinking)) {
      return { ok: false, error: "Unknown thinking level." }
    }
    // Blank means "use the built-in default" — stored as NULL so the install
    // keeps following whatever the app thinks is right rather than freezing
    // today's answer. The model id is deliberately NOT checked against the
    // catalog: it is a live remote list, and a model that has since left it
    // should cost a writer a failed summary they are told about, not a
    // settings page that refuses to save.
    const trimmed = modelId?.trim() ?? ""
    values.summaryModelId = trimmed === "" ? null : trimmed
    values.summaryThinking = thinking
    values.summaryProviderTag = providerTag
    values.summaryZdr = zdr
  }
  if (patch.requireZdr !== undefined) {
    values.requireZdr = patch.requireZdr
  }

  // Ensures the single settings row exists before patching it.
  await getAppSettings()

  if (Object.keys(values).length > 0) {
    const db = await getDb()
    await db.update(appSettings).set(values).where(eq(appSettings.id, 1))
  }

  commitChange(null)
  return { ok: true, data: null }
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
export async function updateGenerationDefaults(
  patch: Partial<GenerationDefaults>
): Promise<ActionResult> {
  const values: Partial<typeof appSettings.$inferInsert> = {}
  if (patch.temperature !== undefined)
    values.defaultTemperature = patch.temperature
  if (patch.topP !== undefined) values.defaultTopP = patch.topP
  if (patch.maxTokens !== undefined) values.defaultMaxTokens = patch.maxTokens
  if (patch.contextWindow !== undefined) {
    if (!isContextWindow(patch.contextWindow)) {
      return { ok: false, error: "Unsupported context window." }
    }
    values.defaultContextWindow = patch.contextWindow
  }
  if (patch.loreBudget !== undefined) {
    values.defaultLoreBudget = clampLoreBudget(patch.loreBudget)
  }
  if (patch.frequencyPenalty !== undefined)
    values.defaultFrequencyPenalty = patch.frequencyPenalty
  if (patch.presencePenalty !== undefined)
    values.defaultPresencePenalty = patch.presencePenalty

  if (Object.keys(values).length === 0) return { ok: true, data: null }

  // Ensures the single settings row exists before patching it.
  await getAppSettings()
  const db = await getDb()
  await db.update(appSettings).set(values).where(eq(appSettings.id, 1))

  // Null, not a story id: the defaults reach every profile, so every device —
  // including ones sitting on a story whose profile inherits — has to hear it.
  commitChange(null)
  return { ok: true, data: null }
}

/**
 * Real key check against OpenRouter, using the single shared key from
 * OPENROUTER_API_KEY. Returns the provider-contract shape { ok, message }
 * (not ActionResult): verification failure is a result, not an error.
 */
export async function verifyOpenRouterKey(): Promise<{
  ok: boolean
  message: string
}> {
  const key = resolveOpenRouterKey()
  if (!key) {
    return { ok: false, message: "OPENROUTER_API_KEY is not configured." }
  }
  try {
    const client = new OpenRouter({ apiKey: key })
    // GET /key — the cheapest call authenticated by a plain inference key.
    await client.apiKeys.getCurrentKeyMetadata()
    return { ok: true, message: "Key verified with OpenRouter." }
  } catch (err) {
    if (err instanceof OpenRouterError && err.statusCode === 401) {
      return { ok: false, message: "OpenRouter rejected this key." }
    }
    return { ok: false, message: "Couldn't reach OpenRouter. Try again." }
  }
}
