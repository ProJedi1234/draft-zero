// tests/model-profiles.test.ts — The two rules that make profiles safe, both
// pinned on the pure half so no database is involved.
//
// 1. Resolution: a followed story generates under the PROFILE — field by field,
//    since a profile's sliders may defer to the global defaults — a Custom story
//    under its own columns, and the columns are never consulted while a profile
//    is in effect; that last one is what makes Custom ⇄ profile lossless.
// 2. Delete: a follower of a deleted profile becomes Custom holding the exact
//    settings it was generating under a moment earlier, not whatever custom
//    settings it happened to have last.

import { describe, expect, test } from "bun:test"

import {
  customColumnsFromSettings,
  resolveGenerationSettings,
  resolveProfileSettings,
} from "@/lib/generation/resolve"
import type {
  GenerationDefaults,
  GenerationSettings,
  ModelProfile,
  ProfileSettings,
} from "@/lib/types"

const CUSTOM: GenerationSettings = {
  modelId: "openai/gpt-5",
  thinking: "high",
  providerTag: "groq",
  temperature: 1.2,
  topP: 0.8,
  maxTokens: 512,
  contextWindow: 4096,
  loreBudget: 25,
  frequencyPenalty: 0.4,
  presencePenalty: -0.2,
}

/** The global sliders every profile falls back to, field by field. */
const DEFAULTS: GenerationDefaults = {
  temperature: 0.5,
  topP: 0.5,
  maxTokens: 256,
  contextWindow: 2048,
  loreBudget: 25,
  frequencyPenalty: -1,
  presencePenalty: -1,
}

const PROFILE_SETTINGS: GenerationSettings = {
  modelId: "~anthropic/claude-sonnet-latest",
  thinking: "off",
  providerTag: null,
  temperature: 0.9,
  topP: 0.95,
  maxTokens: 2048,
  contextWindow: 8192,
  loreBudget: 25,
  frequencyPenalty: 0,
  presencePenalty: 0,
}

/**
 * A profile that overrides every slider — the pre-inheritance shape, which
 * resolves to PROFILE_SETTINGS whatever the defaults say.
 */
const PROFILE_OVERRIDES: ProfileSettings = { ...PROFILE_SETTINGS }

const PROFILE: ModelProfile = {
  id: "profile-quality",
  name: "Quality",
  sortOrder: 0,
  settings: PROFILE_OVERRIDES,
}

describe("resolveProfileSettings", () => {
  test("an overriding profile keeps every value of its own", () => {
    expect(resolveProfileSettings(PROFILE_OVERRIDES, DEFAULTS)).toEqual(
      PROFILE_SETTINGS
    )
  })

  test("a profile with no opinions is the defaults plus its model", () => {
    const inheriting: ProfileSettings = {
      modelId: "openai/gpt-5",
      thinking: "high",
      providerTag: "groq",
      temperature: null,
      topP: null,
      maxTokens: null,
      contextWindow: null,
      loreBudget: null,
      frequencyPenalty: null,
      presencePenalty: null,
    }
    expect(resolveProfileSettings(inheriting, DEFAULTS)).toEqual({
      modelId: "openai/gpt-5",
      thinking: "high",
      providerTag: "groq",
      ...DEFAULTS,
    })
  })

  // The point of the feature: overriding one slider must not freeze the other
  // five at the values they happened to have when it was overridden.
  test("inheritance is per field, not all-or-nothing", () => {
    const mixed: ProfileSettings = { ...PROFILE_OVERRIDES, temperature: null }
    const resolved = resolveProfileSettings(mixed, DEFAULTS)
    expect(resolved.temperature).toBe(DEFAULTS.temperature)
    expect(resolved.topP).toBe(PROFILE_SETTINGS.topP)
  })

  // 0 and -1 are real slider values at the bottom of their ranges; a falsy
  // check instead of a null check would silently replace them with the default.
  test("a zero override is a value, not an absent one", () => {
    const zeroed: ProfileSettings = {
      ...PROFILE_OVERRIDES,
      temperature: 0,
      frequencyPenalty: 0,
    }
    const resolved = resolveProfileSettings(zeroed, DEFAULTS)
    expect(resolved.temperature).toBe(0)
    expect(resolved.frequencyPenalty).toBe(0)
  })
})

describe("resolveGenerationSettings", () => {
  test("a followed story generates under the profile", () => {
    expect(resolveGenerationSettings(CUSTOM, PROFILE, DEFAULTS)).toEqual(
      PROFILE_SETTINGS
    )
  })

  test("a Custom story generates under its own columns", () => {
    expect(resolveGenerationSettings(CUSTOM, null, DEFAULTS)).toEqual(CUSTOM)
  })

  // Custom stories predate inheritance and are untouched by it: their columns
  // are concrete, so the global defaults must never reach them.
  test("a Custom story ignores the global defaults entirely", () => {
    const resolved = resolveGenerationSettings(CUSTOM, null, DEFAULTS)
    expect(resolved.temperature).toBe(CUSTOM.temperature)
    expect(resolved.maxTokens).toBe(CUSTOM.maxTokens)
  })

  test("the story's columns survive the profile untouched", () => {
    const columns = { ...CUSTOM }
    resolveGenerationSettings(columns, PROFILE, DEFAULTS)
    expect(columns).toEqual(CUSTOM)
  })

  // A profile_id whose row is gone (deleted out of band, no FK to stop it) is
  // Custom on the columns the story kept — never an empty or partial settings
  // object, which would reach OpenRouter as a request with no model.
  test("a missing profile falls back to Custom, not to nothing", () => {
    expect(resolveGenerationSettings(CUSTOM, null, DEFAULTS).modelId).toBe(
      CUSTOM.modelId
    )
  })
})

describe("deleteProfile's flip to Custom", () => {
  test("the follower keeps every setting it was generating under", () => {
    const patch = customColumnsFromSettings(PROFILE_SETTINGS)
    expect(patch).toEqual({ profileId: null, ...PROFILE_SETTINGS })
  })

  // Auto routing is a null tag, not an absent one: dropped from the patch it
  // would leave the follower pinned to whatever provider its custom memory held.
  test("Auto routing is copied as an explicit null", () => {
    const patch = customColumnsFromSettings({
      ...PROFILE_SETTINGS,
      providerTag: null,
    })
    expect(patch.providerTag).toBeNull()
    expect("providerTag" in patch).toBe(true)
  })

  test("a flipped follower resolves to what the profile said", () => {
    // What the delete action does to one row, without the database: the
    // follower's columns are overwritten, its profile_id cleared, and the story
    // then reads those columns because there is no profile left to read.
    const follower = { profileId: PROFILE.id, ...CUSTOM }
    const { profileId, ...flipped } = {
      ...follower,
      ...customColumnsFromSettings(PROFILE_SETTINGS),
    }

    expect(profileId).toBeNull()
    expect(resolveGenerationSettings(flipped, null, DEFAULTS)).toEqual(
      PROFILE_SETTINGS
    )
  })

  // The flip is the moment inheritance ends, so the follower has to be handed
  // the numbers it was generating under — a hole in its own columns is not a
  // state a Custom story can be in.
  test("an inherited slider is frozen as a number, not carried over as a hole", () => {
    const inheriting: ProfileSettings = {
      ...PROFILE_OVERRIDES,
      temperature: null,
    }
    const patch = customColumnsFromSettings(
      resolveProfileSettings(inheriting, DEFAULTS)
    )
    expect(patch.temperature).toBe(DEFAULTS.temperature)
  })

  test("a story following another profile is not in the update's path", () => {
    const rows = [
      { id: "a", profileId: PROFILE.id },
      { id: "b", profileId: "profile-cheap" },
      { id: "c", profileId: null },
    ]
    // The action's WHERE clause, spelled out: only the deleted profile's
    // followers are touched, so a Custom story's memory is never overwritten.
    expect(
      rows.filter((row) => row.profileId === PROFILE.id).map((row) => row.id)
    ).toEqual(["a"])
  })
})
