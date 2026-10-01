// GET   /api/settings — the settings page's payload (lib/payloads/settings.ts):
//       the settings row, both model catalogs, the profiles and their followers.
// PATCH /api/settings — the body is a partial patch of the app settings row;
//       only given fields move. Answers with null data: the key is never read here.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { buildSettingsPayload } from "@/lib/payloads/settings"
import { updateAppSettings } from "@/lib/services/settings"
import {
  settingsWriteOutput,
  type UpdateAppSettingsInput,
} from "@/lib/services/settings.schema"

export const runtime = "nodejs"

export async function GET(): Promise<Response> {
  return Response.json(await buildSettingsPayload(), {
    headers: { "cache-control": "no-store" },
  })
}

export async function PATCH(request: Request): Promise<Response> {
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const result = await updateAppSettings(
    body.data as UpdateAppSettingsInput,
    contextOf(request)
  )
  return respond(settingsWriteOutput, result)
}
