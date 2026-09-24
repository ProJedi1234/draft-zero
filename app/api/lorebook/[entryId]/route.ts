// PATCH  /api/lorebook/:entryId — the body is the patch; only given fields move.
// DELETE /api/lorebook/:entryId
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import {
  deleteLorebookEntry,
  updateLorebookEntry,
} from "@/lib/services/lorebook"
import {
  deleteLorebookEntryOutput,
  lorebookEntryWriteOutput,
  type UpdateLorebookEntryInput,
} from "@/lib/services/lorebook.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ entryId: string }> }

export async function PATCH(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { entryId } = await params
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const result = await updateLorebookEntry(
    { id: entryId, patch: body.data as UpdateLorebookEntryInput["patch"] },
    contextOf(request)
  )
  return respond(lorebookEntryWriteOutput, result)
}

export async function DELETE(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { entryId } = await params
  const result = await deleteLorebookEntry({ id: entryId }, contextOf(request))
  return respond(deleteLorebookEntryOutput, result)
}
