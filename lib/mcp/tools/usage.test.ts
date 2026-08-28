// lib/mcp/tools/usage.test.ts — handler shaping logic against a mocked
// getUsageAggregate. No live DB.
import { beforeEach, describe, expect, mock, test } from "bun:test"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"

/* -------------------------------------------------------------------------- */
/* Mocks — declared before importing the module under test                   */
/* -------------------------------------------------------------------------- */

interface FakeAggregate {
  groups: {
    key: string
    calls: number
    costUsd: string
    promptTokens: number
    completionTokens: number
    reasoningTokens: number
    cachedPromptTokens: number
  }[]
  totals: {
    calls: number
    costUsd: string
    promptTokens: number
    completionTokens: number
    reasoningTokens: number
    cachedPromptTokens: number
  }
}

const ZERO_TOTALS = {
  calls: 0,
  costUsd: "0",
  promptTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
  cachedPromptTokens: 0,
}

const getUsageAggregateMock = mock(
  async (_options: unknown): Promise<FakeAggregate> => ({
    groups: [],
    totals: ZERO_TOTALS,
  })
)

installQueryMocks()

const { registerUsage } = await import("@/lib/mcp/tools/usage")

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

type ToolHandler = (
  args: unknown,
  ctx?: unknown
) => Promise<{
  isError?: boolean
  content: { type: string; text: string }[]
  structuredContent?: Record<string, unknown>
}>

function registeredHandler(): ToolHandler {
  let handler: ToolHandler | undefined
  const server = {
    registerTool: (_name: string, _config: unknown, h: ToolHandler) => {
      handler = h
    },
  }
  registerUsage(server as never, undefined as never)
  if (!handler) throw new Error("usage did not register")
  return handler
}

beforeEach(() => {
  stubQueries({ getUsageAggregate: getUsageAggregateMock })
  getUsageAggregateMock.mockClear()
  getUsageAggregateMock.mockImplementation(async () => ({
    groups: [],
    totals: ZERO_TOTALS,
  }))
})

describe("usage", () => {
  test("defaults groupBy to model and forwards the window verbatim", async () => {
    const handler = registeredHandler()

    await handler({
      storyId: "story-1",
      since: "2026-08-01",
      until: "2026-08-28",
    })

    expect(getUsageAggregateMock).toHaveBeenCalledWith({
      storyId: "story-1",
      groupBy: "model",
      since: "2026-08-01",
      until: "2026-08-28",
    })
  })

  test("shapes numeric-string cost sums into numbers and reports the window", async () => {
    getUsageAggregateMock.mockImplementation(async () => ({
      groups: [
        {
          key: "anthropic/claude-sonnet-5",
          calls: 12,
          costUsd: "1.234500000000",
          promptTokens: 40000,
          completionTokens: 8000,
          reasoningTokens: 500,
          cachedPromptTokens: 12000,
        },
      ],
      totals: {
        calls: 12,
        costUsd: "1.234500000000",
        promptTokens: 40000,
        completionTokens: 8000,
        reasoningTokens: 500,
        cachedPromptTokens: 12000,
      },
    }))
    const handler = registeredHandler()

    const result = await handler({ groupBy: "requestKind" })

    expect(result.isError).toBeUndefined()
    const data = result.structuredContent as {
      groups: { key: string; costUsd: number }[]
      totals: { costUsd: number; calls: number }
      window: { since: string; until: string }
    }
    expect(data.groups[0]?.costUsd).toBe(1.2345)
    expect(data.groups[0]?.key).toBe("anthropic/claude-sonnet-5")
    expect(data.totals.costUsd).toBe(1.2345)
    expect(data.totals.calls).toBe(12)
    // No since/until passed — the resolved window reports the "all time" empty
    // string, not a fabricated bound.
    expect(data.window).toEqual({ since: "", until: "" })
  })

  test("summary line names the grouping, group count, calls and total spend", async () => {
    getUsageAggregateMock.mockImplementation(async () => ({
      groups: [
        {
          key: "a",
          calls: 3,
          costUsd: "0.5",
          promptTokens: 0,
          completionTokens: 0,
          reasoningTokens: 0,
          cachedPromptTokens: 0,
        },
        {
          key: "b",
          calls: 2,
          costUsd: "0.25",
          promptTokens: 0,
          completionTokens: 0,
          reasoningTokens: 0,
          cachedPromptTokens: 0,
        },
      ],
      totals: {
        calls: 5,
        costUsd: "0.75",
        promptTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        cachedPromptTokens: 0,
      },
    }))
    const handler = registeredHandler()

    const result = await handler({ groupBy: "day" })

    const text = result.content[0]?.text ?? ""
    expect(text).toContain("by day")
    expect(text).toContain("2 groups")
    expect(text).toContain("5 calls")
    expect(text).toContain("$0.7500")
  })

  test("an empty ledger reports zeroed totals, not an error", async () => {
    const handler = registeredHandler()

    const result = await handler({})

    expect(result.isError).toBeUndefined()
    const data = result.structuredContent as {
      groups: unknown[]
      totals: { calls: number }
    }
    expect(data.groups).toEqual([])
    expect(data.totals.calls).toBe(0)
  })
})
