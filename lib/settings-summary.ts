// lib/settings-summary.ts — The one-line rendering of a settings bundle, shared
// by the settings list and the inspector's profile card and menu.
//
// Pure and catalog-driven: both surfaces already hold the model list, and
// resolving each profile's endpoints instead would be one request per row for a
// line nobody reads twice. A profile pinned to an endpoint therefore shows the
// tag it pinned and the model's own price.

import {
  THINKING_LEVEL_LABELS,
  type GenerationSettings,
  type OpenRouterModel,
} from "@/lib/types"

/**
 * "Claude Sonnet 5 · Auto · think med".
 *
 * A model the catalog doesn't know (retired, or a catalog fetch that failed)
 * degrades to its id, which is still the truth about the bundle.
 */
export function settingsSummary(
  settings: GenerationSettings,
  models: OpenRouterModel[]
): string {
  const { modelId, providerTag, thinking } = settings
  const model = models.find((m) => m.id === modelId)
  return [
    model?.name ?? modelId,
    providerTag ?? "Auto",
    thinking === "off"
      ? "off"
      : `think ${THINKING_LEVEL_LABELS[thinking].toLowerCase()}`,
  ].join(" · ")
}

/**
 * The same line with per-1M pricing appended — for the settings list, where the
 * row is the whole story. The inspector card prints price on its own line
 * instead, against the pinned endpoint it can afford to resolve.
 */
export function settingsSummaryWithPrice(
  settings: GenerationSettings,
  models: OpenRouterModel[]
): string {
  const summary = settingsSummary(settings, models)
  const model = models.find((m) => m.id === settings.modelId)
  return model
    ? `${summary} · ${model.pricing.prompt}/${model.pricing.completion}`
    : summary
}
