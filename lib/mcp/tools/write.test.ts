// lib/mcp/tools/write.test.ts — handler shaping, against mocked writes. No DB.
//
// The tool module is imported at the top level, right after the shared mocks
// (see test-mocks.ts) are wired — not inside a test() body. bun collects
// every *.test.ts's top-level code before running any test, and mock.module
// patches its specifier for the whole run; a dynamic `await import(...)`
// inside a test body would resolve against whatever the LAST file to touch
// these shared specifiers left behind, not this file's own mocks. A static
// import up here binds "@/lib/mcp/tools/write" to this file's mocks at the
// point this file is collected, before any of that can happen.
import { beforeEach, describe, expect, test } from "bun:test"

import type { RegisterTool } from "@/lib/mcp/helpers"
import {
  appendActionEntry,
  appendNarrationEntry,
  commitChange,
  installMocks,
  resetActionMocks,
} from "@/lib/mcp/tools/test-mocks"

installMocks()
const { registerWrite } = await import("@/lib/mcp/tools/write")

/** Captures the handler a registrar hands to `server.registerTool`. */
function capture(register: RegisterTool) {
  let handler: (args: unknown) => Promise<unknown>
  const fakeServer = {
    registerTool: (_name: string, _config: unknown, h: typeof handler) => {
      handler = h
    },
  }
  register(fakeServer as never, {} as never)
  return (args: unknown) => handler(args)
}

describe("write", () => {
  beforeEach(resetActionMocks)

  test("narration goes through appendNarrationEntry, not appendActionEntry", async () => {
    appendNarrationEntry.mockImplementationOnce(async () => ({
      ok: true,
      data: { entry: { position: 5, text: "The door creaks open." } as never },
    }))
    const call = capture(registerWrite)

    const result = (await call({
      storyId: "s1",
      text: "The door creaks open.",
    })) as { structuredContent: Record<string, unknown> }

    expect(appendNarrationEntry).toHaveBeenCalledTimes(1)
    expect(appendActionEntry).not.toHaveBeenCalled()
    expect(commitChange).toHaveBeenCalledWith("s1")
    expect(result.structuredContent).toEqual({
      storyId: "s1",
      position: 5,
      kind: "narration",
      words: 4,
    })
  })

  test("do/say goes through appendActionEntry with the given mode", async () => {
    appendActionEntry.mockImplementationOnce(async () => ({
      ok: true,
      data: { entry: { position: 12, text: "You open the door." } as never },
    }))
    const call = capture(registerWrite)

    const result = (await call({
      storyId: "s1",
      mode: "do",
      text: "open the door",
    })) as { structuredContent: Record<string, unknown> }

    expect(appendActionEntry).toHaveBeenCalledWith("s1", "do", "open the door")
    expect(appendNarrationEntry).not.toHaveBeenCalled()
    expect(result.structuredContent).toMatchObject({ position: 12, kind: "do" })
  })

  test("never echoes prose back in structuredContent", async () => {
    appendNarrationEntry.mockImplementationOnce(async () => ({
      ok: true,
      data: {
        entry: { position: 1, text: "Some long passage of prose." } as never,
      },
    }))
    const call = capture(registerWrite)

    const result = (await call({
      storyId: "s1",
      text: "Some long passage of prose.",
    })) as { structuredContent: Record<string, unknown> }

    expect(JSON.stringify(result.structuredContent)).not.toContain(
      "Some long passage"
    )
  })

  test("a failed append becomes a failed() result, not a throw", async () => {
    appendNarrationEntry.mockImplementationOnce(async () => ({
      ok: false,
      error: "Story not found.",
    }))
    const call = capture(registerWrite)

    const result = (await call({ storyId: "nope", text: "x" })) as {
      isError?: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe("Story not found.")
    expect(commitChange).not.toHaveBeenCalled()
  })
})
