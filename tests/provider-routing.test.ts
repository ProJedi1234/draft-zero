// tests/provider-routing.test.ts — The specification for the provider picker's
// pure half: resolving a stored endpoint tag, and the two readouts the menu
// prints. The routing decision itself (providerParam in lib/generation/
// openrouter.ts) is not covered here — that module is "server-only" and cannot
// be imported into a test runner — but it is a two-line wrapper over
// endpointForTag, which is.

import { describe, expect, test } from "bun:test"

import { formatThroughput, formatUptime } from "@/lib/format"
import { endpointForTag, type ModelEndpoint } from "@/lib/types"

function endpoint(tag: string, throughput: number | null = 100): ModelEndpoint {
  return {
    tag,
    providerName: tag.split("/")[0],
    contextLength: 131_072,
    pricing: { prompt: "$1.00", completion: "$2.00" },
    throughput,
    uptime: 0.99,
    quantization: null,
  }
}

const ENDPOINTS = [endpoint("groq"), endpoint("deepinfra/turbo")]

describe("endpointForTag", () => {
  test("finds the pinned endpoint, variant suffix included", () => {
    expect(endpointForTag(ENDPOINTS, "deepinfra/turbo")?.tag).toBe(
      "deepinfra/turbo"
    )
  })

  test("null tag is Auto, not a lookup failure", () => {
    expect(endpointForTag(ENDPOINTS, null)).toBeNull()
  })

  test("a tag that has left the endpoint list falls back to Auto", () => {
    expect(endpointForTag(ENDPOINTS, "together")).toBeNull()
  })

  test("a bare slug does not match a suffixed endpoint", () => {
    // The reverse of the case above, and the reason the tag is stored whole:
    // "deepinfra" and "deepinfra/turbo" are different endpoints with different
    // speeds, so a partial match would silently reroute the writer.
    expect(endpointForTag(ENDPOINTS, "deepinfra")).toBeNull()
  })

  test("no endpoints means nothing is pinned", () => {
    expect(endpointForTag([], "groq")).toBeNull()
  })
})

describe("formatThroughput", () => {
  test.each([
    [41.6, "42 tps"],
    [0.4, "0 tps"],
    [999, "999 tps"],
    [1_000, "1.0k tps"],
    [1_940, "1.9k tps"],
    // Unmeasured is an em dash, never a zero: a cold endpoint is not a slow one.
    [null, "—"],
    [Number.NaN, "—"],
    [Number.POSITIVE_INFINITY, "—"],
  ] as const)("%p -> %p", (input, expected) => {
    expect(formatThroughput(input)).toBe(expected)
  })
})

describe("formatUptime", () => {
  test.each([
    [0.9987, "99%"],
    // Floored, so only a genuinely perfect week reads as 100%.
    [0.9999, "99%"],
    [1, "100%"],
    [0, "0%"],
    [null, "—"],
  ] as const)("%p -> %p", (input, expected) => {
    expect(formatUptime(input)).toBe(expected)
  })
})
