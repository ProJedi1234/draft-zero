"use server"

import { OpenRouter } from "@openrouter/sdk"
import { OpenRouterError } from "@openrouter/sdk/models/errors"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/lib/db/client"
import { getAppSettings } from "@/lib/db/queries"
import { appSettings } from "@/lib/db/schema"
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
  if (patch.openRouterKey !== undefined)
    values.openRouterKey = patch.openRouterKey.trim()

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
 * Real key check against OpenRouter. Returns the provider-contract shape
 * { ok, message } (not ActionResult): verification failure is a result,
 * not an error. The candidate key is used transiently and never logged.
 */
export async function verifyOpenRouterKey(
  key: string
): Promise<{ ok: boolean; message: string }> {
  const trimmed = key.trim()
  if (!trimmed.startsWith("sk-or-")) {
    return { ok: false, message: "That doesn't look like an OpenRouter key." }
  }
  try {
    const client = new OpenRouter({ apiKey: trimmed })
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
