"use server"

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
