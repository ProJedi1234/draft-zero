// lib/generation/resolve.ts — The one place a story's EFFECTIVE settings are
// decided, and the one place a profile's settings become a story's own again.
//
// Pure on purpose: the rule is a two-line thing that every read path and the
// generation path both depend on, so it is worth a name and a test rather than
// a repeated ternary that can drift.

import type { GenerationSettings, ModelProfile } from "@/lib/types"

/**
 * The settings a story actually generates under: the followed profile's, or its
 * own columns when it is Custom.
 *
 * `storySettings` is never consulted while a profile is in effect — that is
 * exactly what makes the story's columns free to keep holding the custom
 * settings it will return to. A caller that could not load the named profile
 * (deleted out of band) passes null and gets Custom, which is the honest answer:
 * the columns the story kept are the last settings it had.
 */
export function resolveGenerationSettings(
  storySettings: GenerationSettings,
  profile: ModelProfile | null
): GenerationSettings {
  return profile ? profile.settings : storySettings
}

/**
 * The story-row patch that turns a follower of a deleted profile into a Custom
 * story with the settings it was generating under a moment ago.
 *
 * The single place profile code writes a story's settings columns, and it only
 * runs when the profile they were reading through is going away — nothing else
 * may overwrite a story's custom memory. Spelling out every field (rather than
 * spreading `settings`) keeps the patch to the columns it means to touch.
 */
export function customColumnsFromSettings(settings: GenerationSettings): {
  profileId: null
  modelId: string
  thinking: GenerationSettings["thinking"]
  providerTag: string | null
  temperature: number
  topP: number
  maxTokens: number
  contextWindow: number
  frequencyPenalty: number
  presencePenalty: number
} {
  return {
    profileId: null,
    modelId: settings.modelId,
    thinking: settings.thinking,
    providerTag: settings.providerTag,
    temperature: settings.temperature,
    topP: settings.topP,
    maxTokens: settings.maxTokens,
    contextWindow: settings.contextWindow,
    frequencyPenalty: settings.frequencyPenalty,
    presencePenalty: settings.presencePenalty,
  }
}
