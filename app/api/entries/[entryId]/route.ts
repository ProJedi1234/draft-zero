// PATCH  /api/entries/:entryId — rewrite a passage's prose; the body is
//        { storyId, text }. Clears the Say/Do pair, as the editor's hatch does.
// DELETE /api/entries/:entryId — soft-delete a passage; the body is { storyId }.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { deleteEntry, updateEntryText } from "@/lib/services/entries"
import {
  entryWriteOutput,
  type DeleteEntryInput,
  type UpdateEntryTextInput,
} from "@/lib/services/entries.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ entryId: string }> }

export async function PATCH(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { entryId } = await params
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const result = await updateEntryText(
    { ...(body.data as Omit<UpdateEntryTextInput, "entryId">), entryId },
    contextOf(request)
  )
  return respond(entryWriteOutput, result)
}

export async function DELETE(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { entryId } = await params
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const result = await deleteEntry(
    { ...(body.data as Omit<DeleteEntryInput, "entryId">), entryId },
    contextOf(request)
  )
  return respond(entryWriteOutput, result)
}
