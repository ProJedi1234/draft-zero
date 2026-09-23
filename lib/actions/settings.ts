"use server"

import * as settings from "@/lib/services/settings"
import type { ActionResult, AppSettings, GenerationDefaults } from "@/lib/types"

// Settings writes publish a scope-null change with no origin, so these
// wrappers have no Origin option to forward.

export async function updateAppSettings(
  patch: Partial<AppSettings>
): Promise<ActionResult> {
  return settings.updateAppSettings(patch, { origin: null })
}

export async function updateGenerationDefaults(
  patch: Partial<GenerationDefaults>
): Promise<ActionResult> {
  return settings.updateGenerationDefaults(patch, { origin: null })
}

/**
 * Returns the provider-contract shape { ok, message } (not ActionResult):
 * verification failure is a result, not an error.
 */
export async function verifyOpenRouterKey(): Promise<{
  ok: boolean
  message: string
}> {
  const result = await settings.verifyOpenRouterKey({}, { origin: null })
  if (!result.ok) return { ok: false, message: result.error }
  return { ok: result.data.verified, message: result.data.message }
}
