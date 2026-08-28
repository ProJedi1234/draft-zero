// lib/mcp/server.test.ts — the one spec that assembles the real thing.
//
// Every other spec drives a single registrar in isolation, which cannot catch
// the failures that only exist between modules: a registrar server.ts forgot
// to list, two tools claiming one name, a tool that declares an outputSchema
// the SDK then rejects. This builds the factory the route uses and asks it
// `tools/list` over the real handler.
//
// The doubles below are not about behavior — no tool is CALLED here. They
// exist because importing the server pulls in every tool, and through them
// lib/actions/*, which import "server-only": a module that throws outside a
// React Server Component. Each double declares exactly the export names its
// tool imports, matching what that tool's own spec registers, so whichever
// file the shared module registry ends up pointing at satisfies both.
import { describe, expect, mock, test } from "bun:test"

import { EXPIRED_REQUEST_STATE } from "@/lib/mcp/helpers"
import { installQueryMocks } from "@/lib/mcp/tools/test-queries"

installQueryMocks()
mock.module("@/lib/actions/commit", () => ({ commitChange: mock(() => {}) }))
mock.module("@/lib/actions/entries", () => ({
  appendEntryOutsideRun: mock(async () => ({ ok: true, data: null })),
  updateEntryText: mock(async () => ({ ok: true, data: null })),
  rewindToEntry: mock(async () => ({ ok: true, data: null })),
}))
mock.module("@/lib/actions/stories", () => ({
  createStory: mock(async () => ({ ok: true, data: { id: "s1" } })),
  updateStoryMeta: mock(async () => ({ ok: true, data: null })),
  deleteStory: mock(async () => ({ ok: true, data: null })),
}))
mock.module("@/lib/actions/lorebook", () => ({
  createLorebookEntry: mock(async () => ({ ok: true, data: { id: "l1" } })),
  updateLorebookEntry: mock(async () => ({ ok: true, data: null })),
}))
mock.module("@/lib/actions/context", () => ({
  loadEntryContext: mock(async () => ({ ok: true, data: null })),
}))

const { createMcpHandler } = await import("@modelcontextprotocol/server")
const { createMcpServer, recoverExpiredState } =
  await import("@/lib/mcp/server")

/* -------------------------------------------------------------------------- */
/* Driving the handler                                                        */
/* -------------------------------------------------------------------------- */

interface ListedTool {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: Record<string, boolean>
}

/**
 * A claim-less POST, which the SDK serves through its legacy stateless
 * fallback — the 2025 era, and the one that is hand-writable. Both eras come
 * off the same factory, so this exercises the same registrations a modern
 * client would see.
 */
async function listTools(): Promise<ListedTool[]> {
  const handler = createMcpHandler(createMcpServer)
  const response = await handler.fetch(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    })
  )
  expect(response.status).toBe(200)

  const body = await response.text()
  // The transport answers as JSON or as a single SSE frame depending on what
  // the client accepted; take the payload out of either.
  const payload = body.startsWith("{")
    ? body
    : (body.match(/^data: (.*)$/m)?.[1] ?? "")
  const message = JSON.parse(payload) as {
    error?: { message: string }
    result?: { tools: ListedTool[] }
  }
  if (message.error) throw new Error(message.error.message)
  return message.result?.tools ?? []
}

/** The order server.ts fixes: reads, then writes, then the destructive one. */
const EXPECTED_ORDER = [
  "list_stories",
  "story_map",
  "read",
  "search",
  "lore_get",
  "usage",
  "context_breakdown",
  "create_story",
  "write",
  "edit",
  "rewind",
  "lore_write",
  "update_story",
  "delete_story",
]

const READ_TOOLS = new Set([
  "list_stories",
  "story_map",
  "read",
  "search",
  "lore_get",
  "usage",
  "context_breakdown",
])

describe("createMcpServer", () => {
  test("registers all 14 planned tools, in the fixed order", async () => {
    const tools = await listTools()
    expect(tools.map((tool) => tool.name)).toEqual(EXPECTED_ORDER)
  })

  test("every tool declares an object outputSchema", async () => {
    const tools = await listTools()
    for (const tool of tools) {
      // Plan rule 6. Without this the SDK rejects the tool's own results at
      // call time, and a non-object root would be rewrapped as {result: …}.
      expect(
        tool.outputSchema,
        `${tool.name} has no outputSchema`
      ).toBeDefined()
      expect(tool.outputSchema?.type, `${tool.name} outputSchema root`).toBe(
        "object"
      )
    }
  })

  test("every tool declares an input schema and a description", async () => {
    const tools = await listTools()
    for (const tool of tools) {
      expect(tool.inputSchema?.type, `${tool.name} inputSchema root`).toBe(
        "object"
      )
      // The client model reads all fourteen on every tools/list; a nameless
      // one costs it a call to find out what it does.
      expect(tool.description?.length ?? 0, `${tool.name}`).toBeGreaterThan(20)
      expect(tool.title, `${tool.name} has no title`).toBeTruthy()
    }
  })

  test("reads are marked read-only and the destructive ones say so", async () => {
    const tools = await listTools()
    for (const tool of tools) {
      const readOnly = tool.annotations?.readOnlyHint === true
      expect(readOnly, `${tool.name} readOnlyHint`).toBe(
        READ_TOOLS.has(tool.name)
      )
    }
    for (const name of ["edit", "rewind", "delete_story"]) {
      const tool = tools.find((candidate) => candidate.name === name)
      expect(tool?.annotations?.destructiveHint, `${name}`).toBe(true)
    }
  })

  test("builds an independent server per request", async () => {
    // The handler calls the factory once per HTTP request because the 2026
    // revision is stateless; a registrar that leaked state into module scope
    // would throw "tool already registered" on the second list.
    const first = await listTools()
    const second = await listTools()
    expect(second.map((tool) => tool.name)).toEqual(
      first.map((tool) => tool.name)
    )
  })
})

describe("recoverExpiredState", () => {
  const ctx = {} as never

  test("turns a lapsed seal into a payload no tool will claim", async () => {
    // The SDK turns any verify throw into a frozen -32602 raised before the
    // handler runs, so an expired confirmation would otherwise reach the model
    // as an error indistinguishable from "the delete half-happened".
    const verify = recoverExpiredState(async () => {
      throw new Error("expired")
    })

    const payload = await verify("stale", ctx)

    expect(payload).toEqual(EXPIRED_REQUEST_STATE)
    expect(payload.tool).not.toBe("delete_story")
  })

  test.each([["mac"], ["bind"], ["malformed"]])(
    "keeps a %s failure fatal",
    async (reason) => {
      const verify = recoverExpiredState(async () => {
        throw new Error(reason)
      })

      await expect(verify("forged", ctx)).rejects.toThrow(reason)
    }
  )

  test("passes a good seal straight through", async () => {
    const verify = recoverExpiredState(async () => ({
      tool: "delete_story",
      storyId: "s1",
    }))

    expect(await verify("good", ctx)).toEqual({
      tool: "delete_story",
      storyId: "s1",
    })
  })
})
