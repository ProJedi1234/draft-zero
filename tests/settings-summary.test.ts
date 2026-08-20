// tests/settings-summary.test.ts — The one-line rendering of a settings bundle,
// which is the entire second line of every profile row in the app: the settings
// list, the inspector's card, and the menu it opens. Pure, so it is worth
// pinning the two things it has to get right — the Auto/pin distinction and the
// degradation for a model the catalog no longer lists.

import { describe, expect, test } from "bun:test"

import {
  settingsSummary,
  settingsSummaryWithPrice,
} from "@/lib/settings-summary"
import type { GenerationSettings, OpenRouterModel } from "@/lib/types"

const MODELS: OpenRouterModel[] = [
  {
    id: "anthropic/claude-sonnet-5",
    name: "Claude Sonnet 5",
    provider: "Anthropic",
    contextLength: 200_000,
    pricing: { prompt: "$3.00", completion: "$15.00" },
    reasoning: { efforts: ["low", "medium", "high"], mandatory: false },
  },
]

const SETTINGS: GenerationSettings = {
  modelId: "anthropic/claude-sonnet-5",
  thinking: "medium",
  providerTag: null,
  temperature: 0.9,
  topP: 0.95,
  maxTokens: 1024,
  contextWindow: 8192,
  loreBudget: 25,
  frequencyPenalty: 0,
  presencePenalty: 0,
}

describe("settingsSummary", () => {
  test("names the model, Auto routing and the thinking level", () => {
    expect(settingsSummary(SETTINGS, MODELS)).toBe(
      "Claude Sonnet 5 · Auto · think medium"
    )
  })

  test("prints a pinned endpoint's tag in place of Auto", () => {
    expect(
      settingsSummary({ ...SETTINGS, providerTag: "deepinfra/turbo" }, MODELS)
    ).toBe("Claude Sonnet 5 · deepinfra/turbo · think medium")
  })

  test("says off rather than 'think off'", () => {
    expect(settingsSummary({ ...SETTINGS, thinking: "off" }, MODELS)).toBe(
      "Claude Sonnet 5 · Auto · off"
    )
  })

  test("degrades to the id for a model the catalog doesn't list", () => {
    expect(settingsSummary({ ...SETTINGS, modelId: "retired/model" }, [])).toBe(
      "retired/model · Auto · think medium"
    )
  })
})

describe("settingsSummaryWithPrice", () => {
  test("appends per-1M pricing", () => {
    expect(settingsSummaryWithPrice(SETTINGS, MODELS)).toBe(
      "Claude Sonnet 5 · Auto · think medium · $3.00/$15.00"
    )
  })

  test("omits the price entirely when the model is unknown", () => {
    expect(settingsSummaryWithPrice(SETTINGS, [])).toBe(
      "anthropic/claude-sonnet-5 · Auto · think medium"
    )
  })
})
