// tests/zdr-policy.test.ts — How the account-policy probe decides what to ask
// and who to ask it about.
//
// The probe itself is a network call and is not exercised here. What is worth
// pinning is the shape of the question, because OpenRouter answers it per model
// group: an account with Anthropic locked down and Google open is ordinary, and
// a probe that samples "some free models" answers for whichever group it
// happened to land on. Group resolution and candidate selection are what keep
// the answer attached to the model the writer is actually using.

import { describe, expect, mock, test } from "bun:test"

import { zdrGroupForModel, type OpenRouterModel } from "@/lib/types"

// See generation-calls.test.ts for why "server-only" must be neutralised.
mock.module("server-only", () => ({}))

const { probeCandidates } = await import("@/lib/generation/zdr-account")

function model(id: string, prompt = "$1.00"): OpenRouterModel {
  return {
    id,
    name: id,
    provider: id.split("/")[0],
    contextLength: 8192,
    pricing: { prompt, completion: prompt },
    reasoning: null,
    zdr: false,
  }
}

describe("zdrGroupForModel", () => {
  test.each([
    ["anthropic/claude-sonnet-5", "anthropic"],
    ["openai/gpt-5.2", "openai"],
    ["google/gemini-3-flash", "google"],
    // OpenRouter's slug is "x-ai"; the group it names is xAI. The one place the
    // author and the group are spelled differently.
    ["x-ai/grok-4.6", "xai"],
    ["moonshotai/kimi-k3", "other"],
    ["deepseek/deepseek-v4", "other"],
  ] as const)("%p -> %p", (id, group) => {
    expect(zdrGroupForModel(id)).toBe(group)
  })

  test("an alias is its lab's model however it is spelled", () => {
    // The "~" belongs to the id, not to the author — and a router alias is
    // served by the lab it names, so it is governed by that lab's group.
    expect(zdrGroupForModel("~anthropic/claude-sonnet-latest")).toBe(
      "anthropic"
    )
  })
})

describe("probeCandidates", () => {
  const CATALOG = [
    model("anthropic/claude-opus-5", "$15.00"),
    model("anthropic/claude-haiku-4.5", "$1.00"),
    model("openai/gpt-5-nano", "$0.05"),
    model("x-ai/grok-4.6", "$2.00"),
    model("~anthropic/claude-sonnet-latest", "$3.00"),
    model("anthropic/claude-sonnet-5:batch", "$1.50"),
  ]

  test("asks only about the group it was asked about", () => {
    // The whole point: a served Google model says nothing about Anthropic, and
    // the probe that conflated them locked nothing on an account that enforces
    // Anthropic and OpenAI but not Google or xAI.
    expect(probeCandidates(CATALOG, "openai").map((m) => m.id)).toEqual([
      "openai/gpt-5-nano",
    ])
  })

  test("cheapest first — a probe costs a token when the answer is no", () => {
    expect(probeCandidates(CATALOG, "anthropic").map((m) => m.id)).toEqual([
      "anthropic/claude-haiku-4.5",
      "anthropic/claude-opus-5",
    ])
  })

  test("aliases are not probe material", () => {
    // An alias serves nothing itself; its target answers for it, and the target
    // is in the catalog under its own id.
    expect(
      probeCandidates(CATALOG, "anthropic").map((m) => m.id)
    ).not.toContain("~anthropic/claude-sonnet-latest")
  })

  test("neither are the :batch and :free variants", () => {
    // They route differently from the model they are named after, so a refusal
    // on one is not a fact about the group.
    expect(
      probeCandidates(CATALOG, "anthropic").map((m) => m.id)
    ).not.toContain("anthropic/claude-sonnet-5:batch")
  })

  test("OpenRouter's own routers are not a lab and cannot answer for one", () => {
    // "openrouter/auto" is served by whatever it picks, so what happens to it
    // is a fact about that pick, not about a model group.
    const withRouters = [model("openrouter/auto", "$0.00"), ...CATALOG]
    expect(probeCandidates(withRouters, "other").map((m) => m.id)).toEqual([])
  })

  test("a group with nothing to ask about is an empty sample, not a wrong answer", () => {
    expect(probeCandidates(CATALOG, "google")).toEqual([])
  })

  test("the list is not truncated — the caller's budgets decide where to stop", () => {
    // A group's cheap end can be entirely models every provider already serves
    // retention-free, which cannot tell the two policies apart. Cutting the
    // list here at a fixed length is what made Google unanswerable.
    const many = Array.from({ length: 9 }, (_, i) =>
      model(`anthropic/m${i}`, `$${i}.00`)
    )
    expect(probeCandidates(many, "anthropic")).toHaveLength(9)
  })
})
