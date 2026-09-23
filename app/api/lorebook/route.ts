// POST /api/lorebook — create a lore entry. The body is the service's input
// (lib/services/lorebook.schema.ts), storyId included.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { createLorebookEntry } from "@/lib/services/lorebook"
import {
  lorebookEntryWriteOutput,
  type CreateLorebookEntryInput,
} from "@/lib/services/lorebook.schema"

export const runtime = "nodejs"

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const result = await createLorebookEntry(
    body.data as CreateLorebookEntryInput,
    contextOf(request)
  )
  return respond(lorebookEntryWriteOutput, result)
}
