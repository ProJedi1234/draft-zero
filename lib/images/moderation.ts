// lib/images/moderation.ts — Which moderation knob each provider exposes.
//
// Pure and isomorphic, split out of openrouter.ts so the table can be tested:
// the mapping is data about a third party's API, it is keyed by string, and a
// typo in a provider slug fails by silently sending nothing rather than by
// throwing. That is exactly the shape of thing that should have a test.

/**
 * Per-provider moderation, keyed by the author segment of a model id.
 *
 * OpenRouter's own image endpoint has no moderation parameter. What it has is a
 * passthrough allowlist: every endpoint record publishes
 * `allowed_passthrough_parameters`, and those keys are sent nested under
 * `provider.options` keyed by the provider slug. Only two providers in the
 * catalog expose anything moderation-shaped, and they disagree about what the
 * knob even is — OpenAI's is a binary, Black Forest Labs' is a six-point dial
 * covering input and output both — so this is a table rather than a setting.
 *
 * Both values are the permissive end of what the vendor documents, and neither
 * unlocks a prohibited category: OpenAI describes "low" as less restrictive
 * filtering, and BFL's scale defaults to 2 of 6. What they buy is fewer FALSE
 * positives, which is the failure that actually shows up here — a manuscript
 * is allowed to contain a wound, and a writer whose scene bounces for naming
 * one has been told their story is contraband by a filter that was aimed at
 * something else.
 *
 * Google is absent on purpose and not by oversight. Every Gemini image endpoint
 * allows exactly one passthrough key, `cachedContent`; its content guardrails
 * are fixed on the provider's side and no parameter reaches them. Since Gemini
 * is the cheap default a writer is most likely to be holding, this table lowers
 * the refusal rate on some of the catalog and none of the rest — mapImageError
 * surfacing the provider's own refusal text stays the thing that carries it.
 */
export const PROVIDER_OPTIONS: Record<string, Record<string, unknown>> = {
  openai: { moderation: "low" },
  "black-forest-labs": { safety_tolerance: 4 },
}

/** The moderation half of the `provider` block, or undefined when the model's provider has no knob. */
export function providerOptions(
  modelId: string
): { options: Record<string, Record<string, unknown>> } | undefined {
  const slug = modelId.split("/")[0]
  const options = PROVIDER_OPTIONS[slug]
  return options ? { options: { [slug]: options } } : undefined
}

/**
 * The whole `provider` block for one image request, or undefined when there is
 * nothing to say.
 *
 * The ZDR half is belt and braces on purpose, because the two straps fail
 * differently. `zdr: true` is what the chat endpoint documents and what the
 * images endpoint accepts without complaint, but the images docs do not list
 * it, so whether the router honours it there is unverifiable from outside.
 * `only`, pinned to the model's retention-free endpoint tags, IS documented
 * for images — and if a tag ever stops matching, the request 404s rather than
 * quietly routing through an endpoint that retains. Both failure modes land
 * closed, which is the direction a retention promise has to fail in.
 *
 * `zdrTags` is an argument rather than a lookup so this stays pure and
 * testable; the caller reads the tags from lib/generation/zdr's cached list.
 * Empty tags under `zdr` are the CALLER's error to refuse before getting here
 * — sending `{zdr: true}` alone would outsource the refusal to a provider 404
 * whose message names the account's privacy page instead of the real problem.
 */
export function imageProviderParam(
  modelId: string,
  zdr: boolean,
  zdrTags: readonly string[]
):
  | {
      zdr?: true
      only?: string[]
      options?: Record<string, Record<string, unknown>>
    }
  | undefined {
  const moderation = providerOptions(modelId)
  if (!zdr) return moderation
  return {
    zdr: true,
    ...(zdrTags.length > 0 ? { only: [...zdrTags] } : {}),
    ...moderation,
  }
}
