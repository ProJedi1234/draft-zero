// PATCH /api/settings/generation-defaults — the body is a partial patch of the
// six shared generation defaults.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { updateGenerationDefaults } from "@/lib/services/settings"
import {
  settingsWriteOutput,
  type UpdateGenerationDefaultsInput,
} from "@/lib/services/settings.schema"

export const runtime = "nodejs"

export async function PATCH(request: Request): Promise<Response> {
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const result = await updateGenerationDefaults(
    body.data as UpdateGenerationDefaultsInput,
    contextOf(request)
  )
  return respond(settingsWriteOutput, result)
}
