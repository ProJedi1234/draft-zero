// tests/image-moderation.test.ts — Pins the provider-options block we send.
//
// This table is data about somebody else's API, keyed by string on both sides,
// and every way it can be wrong is quiet. Misspell a slug and the options land
// under a key OpenRouter does not recognise; nest one level too few and the
// request is malformed; add a provider that publishes no passthrough allowlist
// and the call is rejected outright for a parameter nobody asked for. None of
// that throws here — it comes back as a refused image and looks like the
// writer's prompt was the problem.

import { describe, expect, test } from "bun:test"

import { PROVIDER_OPTIONS, providerOptions } from "@/lib/images/moderation"

describe("providerOptions", () => {
  test("nests options under the provider slug, as OpenRouter expects", () => {
    expect(providerOptions("openai/gpt-image-1")).toEqual({
      options: { openai: { moderation: "low" } },
    })
  })

  test("reads the slug off the model id, not the whole id", () => {
    expect(providerOptions("black-forest-labs/flux.2-pro")).toEqual({
      options: { "black-forest-labs": { safety_tolerance: 4 } },
    })
  })

  // Gemini publishes exactly one passthrough key, `cachedContent`, and no
  // moderation control of any kind. Sending it one would be rejected, so the
  // absence of a Google row is load-bearing rather than an omission.
  test("sends nothing for providers with no moderation knob", () => {
    expect(providerOptions("google/gemini-2.5-flash-image")).toBeUndefined()
    expect(providerOptions("recraft/recraft-v4")).toBeUndefined()
    expect(providerOptions("nonexistent/model")).toBeUndefined()
  })

  test("an id with no slash yields nothing rather than throwing", () => {
    expect(providerOptions("bare-model-id")).toBeUndefined()
  })

  // Both values are the permissive end of what each vendor documents. If one
  // ever changes it should be a deliberate edit with a reason, not a drive-by.
  test("the permissive values are the documented ones", () => {
    expect(PROVIDER_OPTIONS.openai).toEqual({ moderation: "low" })
    expect(PROVIDER_OPTIONS["black-forest-labs"]).toEqual({
      safety_tolerance: 4,
    })
  })
})
