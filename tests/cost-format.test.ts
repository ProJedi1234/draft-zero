// tests/cost-format.test.ts — The money and token formatters' contract, and
// the band boundaries where they break.
//
// Worth pinning exhaustively because both failure modes are quiet and both are
// lies a writer would act on: rounding a real call down to "$0.00" says a
// generation was free, and printing "$0.00" for a call nobody priced says we
// know it was free. Those two must never render the same way, and neither must
// render as a zero.
//
// The edges get their own cases because that is where a formatter breaks
// without anyone noticing: every band renders something plausible, so a
// misplaced comparison shows up as an extra digit on one figure in one popover
// and nowhere else.
//
// Everything here is a table of [input, exact expected string]. No tolerance,
// no regex: the whole point of these helpers is that a cost renders identically
// on the server and on the client, and "close enough" is not that.

import { describe, expect, test } from "bun:test"

import {
  formatTokenCount,
  formatUsd,
  formatUsdFloor,
  shortModelId,
} from "@/lib/format"

describe("formatUsd — unknown", () => {
  test("null is an em dash, never a zero", () => {
    // The load-bearing distinction in the whole feature: "nobody priced this
    // call" and "this call was free" are different claims and must never
    // render the same way.
    expect(formatUsd(null)).toBe("—")
  })

  test("a non-finite number is unknown, not a figure", () => {
    expect(formatUsd(Number.NaN)).toBe("—")
    expect(formatUsd(Number.POSITIVE_INFINITY)).toBe("—")
    expect(formatUsd(Number.NEGATIVE_INFINITY)).toBe("—")
  })

  test("an unparseable string is unknown", () => {
    expect(formatUsd("")).toBe("—")
    expect(formatUsd("null")).toBe("—")
    expect(formatUsd("—")).toBe("—")
  })
})

describe("formatUsd — Postgres numeric arrives as a string", () => {
  test("a full-scale numeric(20,12) string parses to its band", () => {
    // This is literally what `select cost_usd` hands back through pg. If this
    // ever regressed to string concatenation the ledger would print its own
    // storage format at the reader.
    expect(formatUsd("0.003100000000")).toBe("$0.0031")
    expect(formatUsd("0.042000000000")).toBe("$0.042")
    expect(formatUsd("12.400000000000")).toBe("$12.40")
    expect(formatUsd("1204.550000000000")).toBe("$1,205")
    // The ledger's own shape, straight off a settled row.
    expect(formatUsd("0.000123456789")).toBe("$0.0001")
  })

  test("a summed string and its number twin agree", () => {
    // coalesce(sum(cost_usd), 0)::text vs. a JS float that walked the same
    // path: the aggregate views and the per-block chip must not disagree.
    expect(formatUsd("0.0031")).toBe(formatUsd(0.0031))
    expect(formatUsd("12.4")).toBe(formatUsd(12.4))
    expect(formatUsd("1204.55")).toBe(formatUsd(1204.55))
  })
})

describe("formatUsd — bands", () => {
  test("zero is a zero, not a dash", () => {
    expect(formatUsd(0)).toBe("$0")
    expect(formatUsd("0")).toBe("$0")
    expect(formatUsd("0.000000000000")).toBe("$0")
    expect(formatUsd(-0)).toBe("$0")
  })

  test("below a hundredth of a cent, we say so rather than round to nothing", () => {
    expect(formatUsd(0.00005)).toBe("<$0.0001")
    expect(formatUsd(0.00004)).toBe("<$0.0001")
    expect(formatUsd("0.000000123456")).toBe("<$0.0001")
    // Just under the threshold, one ulp below the boundary case below.
    expect(formatUsd(0.00009999)).toBe("<$0.0001")
  })

  test("the 0.0001 boundary belongs to the four-decimal band", () => {
    expect(formatUsd(0.0001)).toBe("$0.0001")
    expect(formatUsd("0.000100000000")).toBe("$0.0001")
    expect(formatUsd(0.0031)).toBe("$0.0031")
    expect(formatUsd(0.009999)).toBe("$0.0100")
  })

  test("the 0.01 boundary belongs to the three-decimal band", () => {
    // Note the trailing zero: "$0.010", not "$0.01". Deliberate — the band is
    // chosen by magnitude, not by how few digits happen to be significant, so
    // a column of these stays aligned.
    expect(formatUsd(0.01)).toBe("$0.010")
    expect(formatUsd(0.042)).toBe("$0.042")
    expect(formatUsd(0.9994)).toBe("$0.999")
  })

  test("the 1 boundary belongs to the two-decimal band", () => {
    expect(formatUsd(1)).toBe("$1.00")
    expect(formatUsd(12.4)).toBe("$12.40")
    expect(formatUsd(99.994)).toBe("$99.99")
  })

  test("the 100 boundary belongs to the grouped-integer band", () => {
    expect(formatUsd(100)).toBe("$100")
    expect(formatUsd(1204.55)).toBe("$1,205")
    expect(formatUsd(1204.4)).toBe("$1,204")
    expect(formatUsd(1_000_000)).toBe("$1,000,000")
  })

  test("ACCEPTED: a value that rounds up across the 100 boundary keeps cents", () => {
    // 99.999 is < 100, so it takes the two-decimal band and toFixed rounds it
    // to "$100.00" rather than the "$100" the band above would print. Both are
    // truthful; pinned so the one-off is recognised as a choice, not a bug.
    expect(formatUsd(99.999)).toBe("$100.00")
  })

  test("a negative figure keeps its sign outside the dollar", () => {
    // Not reachable from the ledger today, but a credit or a corrected row
    // would be, and "$-0.500" is not a thing.
    expect(formatUsd(-0.5)).toBe("-$0.500")
    expect(formatUsd(-1204.55)).toBe("-$1,205")
    expect(formatUsd(-0.00001)).toBe("-<$0.0001")
  })
})

describe("formatTokenCount", () => {
  test("unknown is an em dash", () => {
    expect(formatTokenCount(null)).toBe("—")
    expect(formatTokenCount(Number.NaN)).toBe("—")
  })

  test("under a thousand is the exact count", () => {
    expect(formatTokenCount(0)).toBe("0")
    expect(formatTokenCount(812)).toBe("812")
    expect(formatTokenCount(999)).toBe("999")
  })

  test("thousands carry one decimal", () => {
    expect(formatTokenCount(1_000)).toBe("1.0k")
    expect(formatTokenCount(1_240)).toBe("1.2k")
    expect(formatTokenCount(18_400)).toBe("18.4k")
  })

  test("millions carry one decimal and an uppercase M", () => {
    expect(formatTokenCount(1_000_000)).toBe("1.0M")
    expect(formatTokenCount(1_200_000)).toBe("1.2M")
  })

  test("ACCEPTED: just under a million still reads in thousands", () => {
    // 999_999 -> "1000.0k", not "1.0M": the bands switch on magnitude, not on
    // the rounded string. A context window's worth of prompt tokens never gets
    // near this, so the wart is cheaper than a second rounding pass.
    expect(formatTokenCount(999_999)).toBe("1000.0k")
  })
})

describe("formatUsdFloor", () => {
  test("a total with nothing unpriced is presented as exact", () => {
    expect(formatUsdFloor("0.420000000000", 0)).toBe("$0.420")
    expect(formatUsdFloor(0, 0)).toBe("$0")
  })

  test("a total containing an unpriced call is marked as a floor", () => {
    // The feature's honesty rule in one line: a sum that provably omits
    // something is never shown as the whole answer.
    expect(formatUsdFloor("0.420000000000", 1)).toBe("$0.420+")
    expect(formatUsdFloor("0", 3)).toBe("$0+")
    expect(formatUsdFloor(1204.55, 9)).toBe("$1,205+")
  })

  test("an unknown total takes no marker", () => {
    // "—+" is not a thing: there is no figure for the "+" to qualify.
    expect(formatUsdFloor(null, 4)).toBe("—")
    expect(formatUsdFloor(Number.NaN, 4)).toBe("—")
  })
})

describe("shortModelId", () => {
  test("the vendor prefix is dropped", () => {
    expect(shortModelId("anthropic/claude-opus-4.1")).toBe("claude-opus-4.1")
    expect(shortModelId("openai/gpt-5")).toBe("gpt-5")
  })

  test("only the last segment survives a multi-segment id", () => {
    // OpenRouter's free/variant ids carry a suffix after a colon and can carry
    // more than one slash; the tail is the part a reader recognises.
    expect(shortModelId("deepseek/deepseek-r1:free")).toBe("deepseek-r1:free")
    expect(shortModelId("a/b/c")).toBe("c")
  })

  test("an id with no vendor is left alone", () => {
    expect(shortModelId("claude-opus-4.1")).toBe("claude-opus-4.1")
    expect(shortModelId("")).toBe("")
  })
})
