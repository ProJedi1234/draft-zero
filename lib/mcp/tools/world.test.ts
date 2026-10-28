import { beforeEach, expect, test } from "bun:test"
import type { z } from "zod"
import { withContentParity } from "@/lib/mcp/tools/test-results"
import { installFakeDb } from "@/lib/services/test-support"
import type { RegisterTool } from "@/lib/mcp/helpers"
const db = installFakeDb()
const { registerWorldState, registerWorldPatch } = await import("./world")
const { reserveRun, releaseRun } = await import("@/lib/generation/live")
type Handler = (args: unknown) => Promise<{
  isError?: boolean
  structuredContent?: unknown
  content: unknown[]
}>
function capture(register: RegisterTool) {
  let handler!: Handler
  let config!: {
    inputSchema: z.ZodType
    outputSchema: z.ZodType
    annotations: { readOnlyHint: boolean }
  }
  register(
    {
      registerTool(name: string, c: typeof config, h: Handler) {
        config = c
        handler = withContentParity(name, h)
      },
    } as never,
    {} as never
  )
  return {
    call: (args: unknown) => handler(config.inputSchema.parse(args)),
    config,
  }
}
beforeEach(() => db.reset())
function script() {
  db.next([{ id: "world-mcp-tests" }])
  db.next([])
  db.next([])
  db.next([])
}
test("world_state is read-only and retains every state field for content-only clients", async () => {
  const tool = capture(registerWorldState)
  expect(tool.config.annotations.readOnlyHint).toBe(true)
  script()
  const result = await tool.call({ storyId: "world-mcp-tests" })
  expect(tool.config.outputSchema.parse(result.structuredContent)).toEqual({
    state: { storyId: "world-mcp-tests", minutes: 0, npcs: [] },
  })
})
test("world_patch applies corrections through the real service", async () => {
  script()
  const result = await capture(registerWorldPatch).call({
    storyId: "world-mcp-tests",
    ops: [{ type: "set-clock", minutes: 90 }],
  })
  expect(result.structuredContent).toEqual({
    storyId: "world-mcp-tests",
    minutes: 90,
    npcs: [],
  })
  expect(db.argsOf(4, "values")?.[0]).toMatchObject({
    source: "manual",
    entryId: null,
  })
})
test("world_patch returns only the NPCs it changed", async () => {
  const npc = (id: string, name: string) => ({
    id,
    storyId: "world-mcp-tests",
    name,
    category: "character",
    npc: true,
    keysJson: "[]",
    content: "",
    enabled: true,
    alwaysActive: false,
    priority: 50,
    createdAt: "0",
    updatedAt: "0",
  })
  db.next([{ id: "world-mcp-tests" }])
  db.next([])
  db.next([npc("vell", "Vell"), npc("mara", "Mara")])
  db.next([])
  const result = await capture(registerWorldPatch).call({
    storyId: "world-mcp-tests",
    ops: [{ type: "set-mind", loreEntryId: "vell", mind: "The tide is late." }],
  })
  expect(result.structuredContent).toMatchObject({
    npcs: [{ loreEntryId: "vell", mind: "The tide is late." }],
  })
  expect((result.structuredContent as { npcs: unknown[] }).npcs).toHaveLength(1)
})
test("world tools return actionable failures without structuredContent", async () => {
  expect(
    await capture(registerWorldState).call({ storyId: "missing" })
  ).toMatchObject({ isError: true })
  expect(reserveRun("world-mcp-tests")).toBe(true)
  try {
    const result = await capture(registerWorldPatch).call({
      storyId: "world-mcp-tests",
      ops: [{ type: "set-clock", minutes: 1 }],
    })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toBeUndefined()
  } finally {
    releaseRun("world-mcp-tests")
  }
})
test("world_patch schema refuses automatic clock advances", () => {
  expect(
    capture(registerWorldPatch).config.inputSchema.safeParse({
      storyId: "world-mcp-tests",
      ops: [{ type: "advance-clock", minutes: 1 }],
    }).success
  ).toBe(false)
})
