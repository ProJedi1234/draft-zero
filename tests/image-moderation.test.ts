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

import {
  PROVIDER_OPTIONS,
  imageProviderParam,
  providerOptions,
} from "@/lib/images/moderation"

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

describe("imageProviderParam", () => {
  test("no policy, no knob: nothing at all", () => {
    expect(imageProviderParam("recraft/recraft-v4", false, [])).toBeUndefined()
  })

  test("no policy: just the moderation block", () => {
    expect(imageProviderParam("openai/gpt-image-1", false, [])).toEqual({
      options: { openai: { moderation: "low" } },
    })
  })

  // Both straps of the belt: `zdr` for the router that honours it, `only`
  // pinned to the retention-free tags for the one that doesn't. Losing either
  // silently would be a retention promise the request no longer keeps.
  test("under ZDR: the flag AND the endpoint pin, together", () => {
    expect(
      imageProviderParam("google/gemini-3-pro-image", true, [
        "google-vertex/global",
      ])
    ).toEqual({
      zdr: true,
      only: ["google-vertex/global"],
    })
  })

  test("under ZDR the moderation block still rides along", () => {
    expect(
      imageProviderParam("black-forest-labs/flux.2-pro", true, ["bfl/zdr"])
    ).toEqual({
      zdr: true,
      only: ["bfl/zdr"],
      options: { "black-forest-labs": { safety_tolerance: 4 } },
    })
  })

  // Empty tags are the caller's error to refuse BEFORE building a request —
  // but if one is built anyway it must still carry the flag, so the failure
  // is a provider refusal rather than a silent routing through retention.
  test("under ZDR with no tags: the flag alone, never an empty pin", () => {
    expect(imageProviderParam("qwen/qwen-image-3", true, [])).toEqual({
      zdr: true,
    })
  })
})
