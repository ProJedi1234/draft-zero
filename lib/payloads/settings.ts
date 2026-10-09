// lib/payloads/settings.ts — Everything the settings page renders with, in one
// JSON-serializable object.
//
// The page and GET /api/settings read this one function, so the props a
// navigation paints and the payload the native client decodes cannot drift.

import {
  countProfileFollowers,
  getAppSettings,
  listModelProfiles,
} from "@/lib/db/queries"
import { listDecisionModels } from "@/lib/generation/decision-models"
import { listModels } from "@/lib/generation/models"
import { getLocalModelsStatus } from "@/lib/generation/ollama"
import {
  getImageModelPrice,
  listImageModels,
  resolveImageModelId,
} from "@/lib/images/models"
import type {
  AppSettings,
  DecisionModel,
  LocalModelsStatus,
  ModelProfile,
  OpenRouterImageModel,
  OpenRouterModel,
} from "@/lib/types"

export interface SettingsPayload {
  settings: AppSettings
  models: OpenRouterModel[]
  /** Every System One model the atmosphere check can be pointed at. */
  decisionModels: DecisionModel[]
  /** The local Ollama host, or null when the server has none configured. */
  localModels: LocalModelsStatus | null
  imageModels: OpenRouterImageModel[]
  /** What the resolved default image model costs per image, or null when unknown. */
  defaultImagePrice: string | null
  profiles: ModelProfile[]
  /** Stories following each profile, keyed by profile id; absent means none. */
  followerCounts: Record<string, number>
}

export async function buildSettingsPayload(): Promise<SettingsPayload> {
  // getAppSettings first, and alone: it lazily seeds the "Default" profile, so
  // listing profiles beside it would race the seed and render an empty card on
  // the very first load.
  const settings = await getAppSettings()
  const [
    models,
    decisionModels,
    localModels,
    imageModels,
    profiles,
    followerCounts,
  ] = await Promise.all([
    listModels(),
    listDecisionModels(),
    getLocalModelsStatus(),
    listImageModels(),
    listModelProfiles(),
    countProfileFollowers(),
  ])
  // Priced for the RESOLVED default — the stored id, or what null falls to —
  // so the card's footnote matches what a fresh story would actually pay.
  const defaultImagePrice = await getImageModelPrice(
    await resolveImageModelId(null, settings.requireZdr)
  )

  return {
    settings,
    models,
    decisionModels,
    localModels,
    imageModels,
    defaultImagePrice,
    profiles,
    followerCounts,
  }
}
