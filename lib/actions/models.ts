"use server"

import { listModelEndpoints } from "@/lib/generation/endpoints"
import type { ActionResult, ModelEndpoint } from "@/lib/types"

/**
 * The upstream endpoints serving one model, for the inspector's provider picker.
 *
 * A read through a server action rather than a prop on the story page: the list
 * is per-model and the writer can change models without a navigation, and it is
 * far too volatile (a five-minute throughput window) to ride along with the
 * page. Cached per model per server process, so repeat opens are free.
 */
export async function getModelEndpoints(
  modelId: string
): Promise<ActionResult<ModelEndpoint[]>> {
  if (modelId.trim() === "") return { ok: false, error: "No model selected." }
  return { ok: true, data: await listModelEndpoints(modelId) }
}
