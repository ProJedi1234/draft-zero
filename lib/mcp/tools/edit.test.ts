// lib/mcp/tools/edit.test.ts — handler shaping, against a mocked position
// lookup and a mocked updateEntryText. No live DB.
//
// See write.test.ts's header for why the tool module is imported at the top
// level rather than inside a test().
import { beforeEach, describe, expect, test } from "bun:test"

import type { RegisterTool } from "@/lib/mcp/helpers"
import {
  getLivePassageAtPosition,
  installMocks,
  resetActionMocks,
  updateEntryText,
} from "@/lib/mcp/tools/test-mocks"

installMocks()
const { registerEdit } = await import("@/lib/mcp/tools/edit")

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

describe("edit", () => {
  beforeEach(resetActionMocks)

  test("rewrites the passage at a live position and reports the word delta", async () => {
    getLivePassageAtPosition.mockImplementation(async () => ({
      id: "e1",
      text: "one two three",
    }))
    const call = capture(registerEdit)

    const result = (await call({
      storyId: "s1",
      position: 4,
      text: "one two three four five",
    })) as { structuredContent: Record<string, unknown> }

    expect(updateEntryText).toHaveBeenCalledWith(
      "s1",
      "e1",
      "one two three four five"
    )
    expect(result.structuredContent).toEqual({
      storyId: "s1",
      position: 4,
      previousWords: 3,
      words: 5,
    })
  })

  test("never echoes prose back in structuredContent", async () => {
    getLivePassageAtPosition.mockImplementation(async () => ({
      id: "e1",
      text: "old text",
    }))
    const call = capture(registerEdit)

    const result = (await call({
      storyId: "s1",
      position: 4,
      text: "brand new replacement prose",
    })) as { structuredContent: Record<string, unknown> }

    expect(JSON.stringify(result.structuredContent)).not.toContain(
      "brand new replacement"
    )
  })

  test("no live passage at the position becomes a model-actionable failure", async () => {
    const call = capture(registerEdit)

    const result = (await call({
      storyId: "s1",
      position: 99,
      text: "x",
    })) as { isError?: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("99")
    expect(updateEntryText).not.toHaveBeenCalled()
  })

  test("propagates a mutation failure as failed(), not a throw", async () => {
    getLivePassageAtPosition.mockImplementation(async () => ({
      id: "e1",
      text: "old",
    }))
    updateEntryText.mockImplementationOnce(async () => ({
      ok: false,
      error: "Passage not found.",
    }))
    const call = capture(registerEdit)

    const result = (await call({
      storyId: "s1",
      position: 4,
      text: "x",
    })) as { isError?: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe("Passage not found.")
  })
})
