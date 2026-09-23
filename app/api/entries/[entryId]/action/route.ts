// POST /api/entries/:entryId/action — re-edit a player turn from its raw
// first-person input; the body is { storyId, rawText, kind: "say" | "do" }.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { updateActionEntry } from "@/lib/services/entries"
import {
  entryWriteOutput,
  type UpdateActionEntryInput,
} from "@/lib/services/entries.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ entryId: string }> }

export async function POST(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { entryId } = await params
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const result = await updateActionEntry(
    { ...(body.data as Omit<UpdateActionEntryInput, "entryId">), entryId },
    contextOf(request)
  )
  return respond(entryWriteOutput, result)
}
