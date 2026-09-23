// POST /api/profiles — create a model profile. The body is the service's input
// (lib/services/profiles.schema.ts): a name and a full settings bundle.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { createProfile } from "@/lib/services/profiles"
import {
  profileIdOutput,
  type CreateProfileInput,
} from "@/lib/services/profiles.schema"

export const runtime = "nodejs"

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const result = await createProfile(
    body.data as CreateProfileInput,
    contextOf(request)
  )
  return respond(profileIdOutput, result)
}
