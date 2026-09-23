// POST /api/import/scenario — import a NovelAI `.scenario` as a new story. The
// body is { json, placeholderValues? }, with json the raw file text.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { importScenario } from "@/lib/services/import"
import {
  scenarioImportOutput,
  type ImportScenarioInput,
} from "@/lib/services/import.schema"

export const runtime = "nodejs"

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const result = await importScenario(
    body.data as ImportScenarioInput,
    contextOf(request)
  )
  return respond(scenarioImportOutput, result)
}
