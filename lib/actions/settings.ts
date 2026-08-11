"use server"

import { OpenRouter } from "@openrouter/sdk"
import { OpenRouterError } from "@openrouter/sdk/models/errors"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/lib/db/client"
import { getAppSettings } from "@/lib/db/queries"
import { appSettings } from "@/lib/db/schema"
import { resolveOpenRouterKey } from "@/lib/generation/key"
import type { ActionResult, AppSettings } from "@/lib/types"

export async function updateAppSettings(
  patch: Partial<AppSettings>
): Promise<ActionResult> {
  const values: Partial<typeof appSettings.$inferInsert> = {}
  if (patch.defaultModelId !== undefined) {
    const modelId = patch.defaultModelId.trim()
    if (modelId === "") return { ok: false, error: "Pick a default model." }
    values.defaultModelId = modelId
  }

  // Ensures the single settings row exists before patching it.
  await getAppSettings()

  if (Object.keys(values).length > 0) {
    const db = await getDb()
    await db.update(appSettings).set(values).where(eq(appSettings.id, 1))
  }

  revalidatePath("/", "layout")
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
