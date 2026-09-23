// GET  /api/entries?storyId=&beforePosition=&limit= — one page of older
//      passages, walking backward from the loaded window's start.
// POST /api/entries — append one passage from outside the story's run: the
//      body is { storyId, mode: "narration" | "say" | "do", text }.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { commitChange } from "@/lib/services/commit"
import { appendEntryOutsideRun, loadOlderEntries } from "@/lib/services/entries"
import {
  appendEntryOutput,
  olderEntriesPageOutput,
  type AppendEntryOutsideRunInput,
} from "@/lib/services/entries.schema"

export const runtime = "nodejs"

/** A missing query param stays undefined; anything else is left to the schema. */
function numberParam(params: URLSearchParams, name: string) {
  const value = params.get(name)
  return value === null ? undefined : Number(value)
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const result = await loadOlderEntries(
    {
      storyId: params.get("storyId") ?? "",
      beforePosition: numberParam(params, "beforePosition") as number,
      limit: numberParam(params, "limit"),
    },
    contextOf(request)
  )
  return respond(olderEntriesPageOutput, result)
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const input = body.data as AppendEntryOutsideRunInput
  const result = await appendEntryOutsideRun(input, contextOf(request))
  // The service leaves the commit to its caller (see appendEntryOutsideRun);
  // this caller has no optimistic echo to protect, so it commits at once.
  if (result.ok) commitChange(input.storyId)
  return respond(appendEntryOutput, result)
}
