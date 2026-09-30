// GET /api/usage — the usage page's payload (lib/payloads/usage.ts): global
// spend, the thirty-day strip, and spend by story, model and image model.
import { buildUsagePayload } from "@/lib/payloads/usage"

// Node, matching every other route here: the pg pool is a singleton in this
// process.
export const runtime = "nodejs"

export async function GET(): Promise<Response> {
  return Response.json(await buildUsagePayload(), {
    headers: { "cache-control": "no-store" },
  })
}
