"use server"

import * as models from "@/lib/services/models"
import { NO_ORIGIN } from "@/lib/services/context"
import type { ActionResult, ModelEndpoint } from "@/lib/types"

export async function getModelEndpoints(
  modelId: string
): Promise<ActionResult<ModelEndpoint[]>> {
  return models.getModelEndpoints({ modelId }, NO_ORIGIN)
}
