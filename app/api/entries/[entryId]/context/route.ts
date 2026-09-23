// GET /api/entries/:entryId/context?storyId= — what this passage would be sent
// now, composed from the manuscript before it. Null data when the passage is no
// longer in the manuscript.
import { contextOf, respond } from "@/lib/api/respond"
import { loadEntryContext } from "@/lib/services/entries"
import { entryContextOutput } from "@/lib/services/entries.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ entryId: string }> }

export async function GET(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { entryId } = await params
  const storyId = new URL(request.url).searchParams.get("storyId") ?? ""
  const result = await loadEntryContext(
    { storyId, entryId },
    contextOf(request)
  )
  return respond(entryContextOutput, result)
}
