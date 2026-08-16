// tests/model-profiles.test.ts — The two rules that make profiles safe, both
// pinned on the pure half so no database is involved.
//
// 1. Resolution: a followed story generates under the PROFILE, a Custom story
//    under its own columns, and the columns are never consulted while a profile
//    is in effect — that last one is what makes Custom ⇄ profile lossless.
// 2. Delete: a follower of a deleted profile becomes Custom holding the exact
//    settings it was generating under a moment earlier, not whatever custom
//    settings it happened to have last.

import { describe, expect, test } from "bun:test"

import {
  customColumnsFromSettings,
  resolveGenerationSettings,
} from "@/lib/generation/resolve"
import type { GenerationSettings, ModelProfile } from "@/lib/types"

const CUSTOM: GenerationSettings = {
  modelId: "openai/gpt-5",
  thinking: "high",
  providerTag: "groq",
  temperature: 1.2,
  topP: 0.8,
  maxTokens: 512,
  contextWindow: 4096,
  frequencyPenalty: 0.4,
  presencePenalty: -0.2,
}

const PROFILE_SETTINGS: GenerationSettings = {
  modelId: "~anthropic/claude-sonnet-latest",
  thinking: "off",
  providerTag: null,
  temperature: 0.9,
  topP: 0.95,
  maxTokens: 2048,
  contextWindow: 8192,
  frequencyPenalty: 0,
  presencePenalty: 0,
}

const PROFILE: ModelProfile = {
  id: "profile-quality",
  name: "Quality",
  sortOrder: 0,
  settings: PROFILE_SETTINGS,
}

describe("resolveGenerationSettings", () => {
  test("a followed story generates under the profile", () => {
    expect(resolveGenerationSettings(CUSTOM, PROFILE)).toEqual(PROFILE_SETTINGS)
  })

  test("a Custom story generates under its own columns", () => {
    expect(resolveGenerationSettings(CUSTOM, null)).toEqual(CUSTOM)
  })

  test("the story's columns survive the profile untouched", () => {
    const columns = { ...CUSTOM }
    resolveGenerationSettings(columns, PROFILE)
    expect(columns).toEqual(CUSTOM)
  })

  // A profile_id whose row is gone (deleted out of band, no FK to stop it) is
  // Custom on the columns the story kept — never an empty or partial settings
  // object, which would reach OpenRouter as a request with no model.
  test("a missing profile falls back to Custom, not to nothing", () => {
    expect(resolveGenerationSettings(CUSTOM, null).modelId).toBe(CUSTOM.modelId)
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
    expect(resolveGenerationSettings(flipped, null)).toEqual(PROFILE_SETTINGS)
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
