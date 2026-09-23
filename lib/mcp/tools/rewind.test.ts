// lib/mcp/tools/rewind.test.ts — handler shaping, against mocked position
// reads and the real rewindToEntry service over a scripted drizzle chain.
// No live DB.
//
// See write.test.ts's header for why the tool module is imported at the top
// level rather than inside a test().
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import type { RegisterTool } from "@/lib/mcp/helpers"
import {
  countLivePassagesAfter,
  getLivePassageAtPosition,
  installMocks,
  resetActionMocks,
} from "@/lib/mcp/tools/test-mocks"
import { stubQueries } from "@/lib/mcp/tools/test-queries"
import { captureBus } from "@/lib/services/test-support"

const db = await installMocks()
const { registerRewind } = await import("@/lib/mcp/tools/rewind")

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

let bus: Awaited<ReturnType<typeof captureBus>>

describe("rewind", () => {
  beforeEach(async () => {
    resetActionMocks(db)
    bus = await captureBus()
  })
  afterEach(() => bus.stop())

  /** The anchor passage `toPosition` names, and how many live rows follow it. */
  function anchorAt(id: string, after: number) {
    getLivePassageAtPosition.mockImplementation(async () => ({ id, text: "" }))
    countLivePassagesAfter.mockImplementation(async () => after)
  }

  /** The service's anchor read and its cut, as the db answers them. */
  function cutLands(position: number, removed: string[]) {
    db.next([{ position }])
    db.next(removed.map((id) => ({ id })))
  }

  test("rewinds to a live position and reports the retired count", async () => {
    anchorAt("e10", 6)
    cutLands(10, ["e11", "e12", "e13", "e14", "e15", "e16"])
    const call = capture(registerRewind)

    const result = (await call({ storyId: "s1", toPosition: 10 })) as {
      structuredContent: Record<string, unknown>
    }

    expect(db.statements[0]?.root).toBe("select")
    expect(db.statements[1]?.root).toBe("update")
    expect(bus.events).toEqual([{ kind: "change", storyId: "s1" }])
    expect(result.structuredContent).toEqual({
      storyId: "s1",
      lastPosition: 10,
      removed: 6,
    })
  })

  test("reports the tail read back after the cut, not the anchor", async () => {
    // Rewind only touches story_entries, but both tables share one position
    // counter — a live image past the anchor survives and is still the last
    // slot. Answering `lastPosition: 10` here would contradict the next read.
    anchorAt("e10", 6)
    cutLands(10, ["e11"])
    stubQueries({
      getLivePassageAtPosition,
      countLivePassagesAfter,
      getManuscriptBounds: async () => ({ first: 0, last: 14, empty: false }),
    })
    const call = capture(registerRewind)

    const result = (await call({ storyId: "s1", toPosition: 10 })) as {
      content: { text: string }[]
      structuredContent: Record<string, unknown>
    }

    expect(result.structuredContent).toEqual({
      storyId: "s1",
      lastPosition: 14,
      removed: 6,
    })
    expect(result.content[0]?.text).toContain("images kept, tail now 14")
  })

  test("no live passage at toPosition becomes a model-actionable failure", async () => {
    const call = capture(registerRewind)

    const result = (await call({ storyId: "s1", toPosition: 99 })) as {
      isError?: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("99")
    expect(db.statements).toEqual([])
  })

  test("nothing after the anchor refuses before calling the service", async () => {
    anchorAt("e10", 0)
    const call = capture(registerRewind)

    const result = (await call({ storyId: "s1", toPosition: 10 })) as {
      isError?: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(db.statements).toEqual([])
  })

  test("propagates a mutation failure as failed(), not a throw", async () => {
    anchorAt("e10", 2)
    db.next([])
    const call = capture(registerRewind)

    const result = (await call({ storyId: "s1", toPosition: 10 })) as {
      isError?: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe("Passage not found.")
    expect(bus.events).toEqual([])
  })
})
