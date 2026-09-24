// lib/services/generation.test.ts — the generation service's refusals, against
// the REAL run registry (lib/generation/live.ts). Nothing here gets past the
// reservation into a launch, so no model is ever called.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { captureBus, installFakeDb } from "@/lib/services/test-support"

const db = installFakeDb()
const generation = await import("@/lib/services/generation")
const live = await import("@/lib/generation/live")

// A story id no other spec reserves, since the registry is process-global.
const STORY = "gen-service-spec-story"
const CTX = { origin: "device-a" }

function registry() {
  return (
    globalThis as unknown as {
      __draftZeroLive: { stopRequested: Set<string> }
    }
  ).__draftZeroLive
}

let bus: Awaited<ReturnType<typeof captureBus>>

beforeEach(async () => {
  db.reset()
  bus = await captureBus()
})

afterEach(() => {
  bus.stop()
  live.releaseRun(STORY)
})

describe("startGeneration", () => {
  test("a story that already holds a run is a conflict, and writes nothing", async () => {
    expect(live.reserveRun(STORY, "other-turn")).toBe(true)
    const result = await generation.startGeneration(
      { storyId: STORY, kind: "say", userText: "Hello.", turnId: "mine" },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "conflict",
      error: "A generation is already running for this story.",
    })
    // The loser must not release the holder's reservation.
    expect(live.isRunActive(STORY)).toBe(true)
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([])
  })

  test("rejects a malformed call before reserving anything", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ storyId: "not an id" }, "Invalid story id."],
      [
        { storyId: STORY, kind: "shout", userText: "x" },
        "Unknown action kind.",
      ],
      [
        { storyId: STORY, kind: "say", userText: 7 },
        "Nothing to add — write something first.",
      ],
    ]
    for (const [input, error] of cases) {
      const result = await generation.startGeneration(input as never, CTX)
      expect(result).toEqual({ ok: false, code: "invalid", error })
      expect(live.isRunActive(STORY)).toBe(false)
    }
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([])
  })
})

describe("stopGeneration", () => {
  test("a bare stop latches the reservation carrying its start's turnId", async () => {
    live.reserveRun(STORY, "turn-1")
    const result = await generation.stopGeneration(
      { storyId: STORY, runId: null, startTurnId: "turn-1" },
      CTX
    )
    expect(result).toEqual({ ok: true, data: null })
    expect(registry().stopRequested.has(STORY)).toBe(true)
  })

  test("a bare stop with another start's turnId latches nothing", async () => {
    live.reserveRun(STORY, "turn-1")
    await generation.stopGeneration(
      { storyId: STORY, startTurnId: "turn-2" },
      CTX
    )
    expect(registry().stopRequested.has(STORY)).toBe(false)
  })

  test("is ok and a no-op when nothing is running", async () => {
    const result = await generation.stopGeneration({ storyId: STORY }, CTX)
    expect(result).toEqual({ ok: true, data: null })
    expect(registry().stopRequested.has(STORY)).toBe(false)
  })

  test("rejects a malformed story id", async () => {
    const result = await generation.stopGeneration({ storyId: "a b" }, CTX)
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Invalid story id.",
    })
  })
})
