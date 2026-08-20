// tests/zdr-policy.test.ts — How the account-policy probe picks what to ask
// about.
//
// The probe itself is a network call and is not exercised here; what is worth
// pinning is the sample it draws, because the conclusion "every model was
// refused, so the account enforces zero data retention" is only sound if the
// sample could have disagreed with itself. A sample of five models from one
// author cannot.

import { describe, expect, mock, test } from "bun:test"

import type { OpenRouterModel } from "@/lib/types"

// See generation-calls.test.ts for why "server-only" must be neutralised.
mock.module("server-only", () => ({}))

const { probeModels } = await import("@/lib/generation/zdr")

function model(id: string): OpenRouterModel {
  return {
    id,
    name: id,
    provider: id.split("/")[0],
    contextLength: 8192,
    pricing: { prompt: "$0.00", completion: "$0.00" },
    reasoning: null,
  }
}

const FREE = [
  model("alpha/one:free"),
  model("alpha/two:free"),
  model("beta/one:free"),
  model("gamma/one:free"),
]

describe("probeModels", () => {
  test("only free models are ever asked about", () => {
    const models = [...FREE, model("alpha/paid")]
    expect(probeModels(models, new Set()).map((m) => m.id)).not.toContain(
      "alpha/paid"
    )
  })

  test("a model with a ZDR endpoint proves nothing and is skipped", () => {
    // It would be served under either policy, so its success is not an answer.
    const picked = probeModels(FREE, new Set(["beta/one:free"]))
    expect(picked.map((m) => m.id)).not.toContain("beta/one:free")
  })

  test("at most one model per author, so refusals are independent votes", () => {
    expect(probeModels(FREE, new Set()).map((m) => m.id)).toEqual([
      "alpha/one:free",
      "beta/one:free",
      "gamma/one:free",
    ])
  })

  test("router aliases are not probe material", () => {
    // An alias serves nothing itself; what answers for it is its target, which
    // is in the list under its own id.
    const picked = probeModels(
      [model("~alpha/latest:free"), ...FREE],
      new Set()
    )
    expect(picked.map((m) => m.id)).not.toContain("~alpha/latest:free")
  })

  test("the sample is capped — five refusals is the evidence, not fifty", () => {
    const many = Array.from({ length: 12 }, (_, i) => model(`lab${i}/m:free`))
    expect(probeModels(many, new Set())).toHaveLength(5)
  })

  test("nothing free to ask about is an empty sample, not a wrong answer", () => {
    expect(probeModels([model("alpha/paid")], new Set())).toEqual([])
  })
})
