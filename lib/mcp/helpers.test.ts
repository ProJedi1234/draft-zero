// lib/mcp/helpers.test.ts — the shared range/limit vocabulary every read speaks.
import { describe, expect, test } from "bun:test"

import { resolveRange, ToolInputError } from "@/lib/mcp/helpers"

describe("resolveRange", () => {
  test("defaults to the whole story taken from its tail", () => {
    expect(resolveRange({}, { first: 0, last: 99 }, 10)).toEqual({
      from: 0,
      to: 99,
      limit: 10,
      take: "tail",
    })
  })

  test("keeps `limit` a row count, not a span of positions", () => {
    // A rewound story: live rows sit at 0–5 and 20, the numbers between them
    // belong to soft-deleted takes. Deriving `from` as last-limit+1 would ask
    // for positions 11–20 and hand back a single entry for a limit of 10.
    const range = resolveRange({}, { first: 0, last: 20 }, 10)
    expect(range.from).toBe(0)
    expect(range.take).toBe("tail")
  })

  test("caps a both-endpoints window instead of dropping the limit", () => {
    // `from: 'start', to: 'end'` is a whole-manuscript request; it must still
    // page rather than return every passage in one result.
    expect(
      resolveRange({ from: "start", to: "end" }, { first: 0, last: 4999 }, 10)
    ).toEqual({ from: 0, to: 4999, limit: 10, take: "head" })
  })

  test("reads forward from a lone `from`", () => {
    expect(resolveRange({ from: 4 }, { first: 0, last: 99 }, 10)).toEqual({
      from: 4,
      to: 99,
      limit: 10,
      take: "head",
    })
  })

  test("reads backward to a lone `to`", () => {
    expect(resolveRange({ to: 40 }, { first: 0, last: 99 }, 10)).toEqual({
      from: 0,
      to: 40,
      limit: 10,
      take: "tail",
    })
  })

  test("an empty story resolves to an empty window", () => {
    const range = resolveRange({}, { first: 0, last: -1 }, 10)
    expect(range.to).toBeLessThan(range.from)
  })

  test("rejects windows that cannot hold anything", () => {
    expect(() => resolveRange({ from: 40 }, { first: 0, last: 5 }, 10)).toThrow(
      ToolInputError
    )
    expect(() => resolveRange({ to: 3 }, { first: 10, last: 20 }, 10)).toThrow(
      ToolInputError
    )
    expect(() =>
      resolveRange({ from: 9, to: 2 }, { first: 0, last: 20 }, 10)
    ).toThrow(ToolInputError)
  })
})
