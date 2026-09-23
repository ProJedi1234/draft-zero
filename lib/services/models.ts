// lib/services/models.ts — Model catalog reads, callable from a server action,
// a route handler or an MCP tool alike.
import "server-only"

import { listModelEndpoints } from "@/lib/generation/endpoints"
import type { Service } from "@/lib/services/context"
import {
  getModelEndpointsInput,
  type GetModelEndpointsInput,
} from "@/lib/services/models.schema"
import { ok, parseInput } from "@/lib/services/result"
import type { ModelEndpoint } from "@/lib/types"

/**
 * The upstream endpoints serving one model, for the inspector's provider picker.
 *
 * A read on demand rather than a prop on the story page: the list is per-model
 * and the writer can change models without a navigation, and it is far too
 * volatile (a five-minute throughput window) to ride along with the page.
 * Cached per model per server process, so repeat opens are free.
 */
export const getModelEndpoints: Service<
  GetModelEndpointsInput,
  ModelEndpoint[]
> = async (raw) => {
  const parsed = parseInput(getModelEndpointsInput, raw)
  if (!parsed.ok) return parsed
  return ok(await listModelEndpoints(parsed.data.modelId))
}
