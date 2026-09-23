// POST /api/profiles/reorder — the body is { orderedIds }, the whole list in
// its new order. A list that no longer matches the server's is a 409.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { reorderProfiles } from "@/lib/services/profiles"
import {
  profileWriteOutput,
  type ReorderProfilesInput,
} from "@/lib/services/profiles.schema"

export const runtime = "nodejs"

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const result = await reorderProfiles(
    body.data as ReorderProfilesInput,
    contextOf(request)
  )
  return respond(profileWriteOutput, result)
}
