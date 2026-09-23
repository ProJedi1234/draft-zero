// POST /api/entries/:entryId/rewind — set aside every live passage after this
// one, as a single undoable op; the body is { storyId }.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { rewindToEntry } from "@/lib/services/entries"
import {
  entryWriteOutput,
  type RewindToEntryInput,
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
  const result = await rewindToEntry(
    { ...(body.data as Omit<RewindToEntryInput, "entryId">), entryId },
    contextOf(request)
  )
  return respond(entryWriteOutput, result)
}
