// POST /api/settings/verify-key — checks the server's OpenRouter key with
// OpenRouter. No body. The answer says whether it passed, never what it is.
import { contextOf, respond } from "@/lib/api/respond"
import { verifyOpenRouterKey } from "@/lib/services/settings"
import { verifyOpenRouterKeyOutput } from "@/lib/services/settings.schema"

export const runtime = "nodejs"

export async function POST(request: Request): Promise<Response> {
  const result = await verifyOpenRouterKey({}, contextOf(request))
  return respond(verifyOpenRouterKeyOutput, result)
}
