// lib/mcp/tools/edit.test.ts — handler shaping, against a mocked position
// lookup and the real updateEntryText service over a scripted drizzle chain.
// No live DB.
//
// See write.test.ts's header for why the tool module is imported at the top
// level rather than inside a test().
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import type { RegisterTool } from "@/lib/mcp/helpers"
import {
  getLivePassageAtPosition,
  installMocks,
  resetActionMocks,
} from "@/lib/mcp/tools/test-mocks"
import { captureBus } from "@/lib/services/test-support"

const db = await installMocks()
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

/** The prose read and the passage update the service opens with. */
function editLands(previous: string) {
  db.next([{ text: previous, actionKind: null, inputText: null }])
  db.next([{ id: "e1" }])
}

let bus: Awaited<ReturnType<typeof captureBus>>

describe("edit", () => {
  beforeEach(async () => {
    resetActionMocks(db)
    bus = await captureBus()
  })
  afterEach(() => bus.stop())

  test("rewrites the passage at a live position and reports the word delta", async () => {
    getLivePassageAtPosition.mockImplementation(async () => ({
      id: "e1",
      text: "one two three",
    }))
    editLands("one two three")
    const call = capture(registerEdit)

    const result = (await call({
      storyId: "s1",
      position: 4,
      text: "one two three four five",
    })) as { structuredContent: Record<string, unknown> }

    expect(db.argsOf(1, "set")?.[0]).toEqual({
      text: "one two three four five",
      actionKind: null,
      inputText: null,
    })
    expect(bus.events).toEqual([{ kind: "change", storyId: "s1" }])
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
    editLands("old text")
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
    expect(db.statements).toEqual([])
  })

  test("propagates a mutation failure as failed(), not a throw", async () => {
    getLivePassageAtPosition.mockImplementation(async () => ({
      id: "e1",
      text: "old",
    }))
    db.next([])
    const call = capture(registerEdit)

    const result = (await call({
      storyId: "s1",
      position: 4,
      text: "x",
    })) as { isError?: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe("Passage not found.")
    expect(bus.events).toEqual([])
  })
})
