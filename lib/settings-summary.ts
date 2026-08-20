// lib/settings-summary.ts — The one-line rendering of a settings bundle, shared
// by the settings list and the inspector's profile card and menu.
//
// Pure and catalog-driven: both surfaces already hold the model list, and
// resolving each profile's endpoints instead would be one request per row for a
// line nobody reads twice. A profile pinned to an endpoint therefore shows the
// tag it pinned and the model's own price.
//
// Only the model half of a bundle is printed, which is why the parameter is
// GenerationIdentity: a profile's sliders may be inherited, and the line would
// have to resolve them before it could say anything true about them.

import {
  THINKING_LEVEL_LABELS,
  type GenerationIdentity,
  type OpenRouterModel,
} from "@/lib/types"

/**
 * The same three parts, unjoined — for the inspector's status strip, which
 * gives the model its own line and truncates it independently of the two short
 * facts beside it. Splitting the joined string instead would make " · " load
 * bearing inside a model name.
 *
 * A model the catalog doesn't know (retired, or a catalog fetch that failed)
 * degrades to its id, which is still the truth about the bundle.
 */
export function settingsSummaryParts(
  settings: GenerationIdentity,
  models: OpenRouterModel[]
): { model: string; provider: string; thinking: string } {
  const { modelId, providerTag, thinking } = settings
  const model = models.find((m) => m.id === modelId)
  return {
    model: model?.name ?? modelId,
    provider: providerTag ?? "Auto",
    thinking:
      thinking === "off"
        ? "off"
        : `think ${THINKING_LEVEL_LABELS[thinking].toLowerCase()}`,
  }
}

/** "Claude Sonnet 5 · Auto · think med". */
export function settingsSummary(
  settings: GenerationIdentity,
  models: OpenRouterModel[]
): string {
  const { model, provider, thinking } = settingsSummaryParts(settings, models)
  return [model, provider, thinking].join(" · ")
}

/**
 * The same line with per-1M pricing appended — for the settings list, where the
 * row is the whole story. The inspector card prints price on its own line
 * instead, against the pinned endpoint it can afford to resolve.
 */
export function settingsSummaryWithPrice(
  settings: GenerationIdentity,
  models: OpenRouterModel[]
): string {
  const summary = settingsSummary(settings, models)
  const model = models.find((m) => m.id === settings.modelId)
  return model
    ? `${summary} · ${model.pricing.prompt}/${model.pricing.completion}`
    : summary
}
