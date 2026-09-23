// tests/api/generation-routes.test.ts — round trips through the start/stop
// route over the real service and run registry. Every start here is refused
// before launch, so no model is called.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { ORIGIN_HEADER } from "@/lib/services/context"

import { captureBus, installFakeDb } from "@/lib/services/test-support"

const db = installFakeDb()
// After installFakeDb: respond.ts imports server-only, which throws unless doubled.
const route = await import("@/app/api/stories/[storyId]/generation/route")
const live = await import("@/lib/generation/live")

// A story id no other spec reserves, since the registry is process-global.
const STORY = "gen-routes-spec-story"
const ENDPOINT = `http://local/api/stories/${STORY}/generation`
const params = { params: Promise.resolve({ storyId: STORY }) }

function request(method: string, body?: unknown) {
  return new Request(ENDPOINT, {
    method,
    headers: { "content-type": "application/json", [ORIGIN_HEADER]: "phone-1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function stopLatched() {
  return (
    globalThis as unknown as {
      __draftZeroLive: { stopRequested: Set<string> }
    }
  ).__draftZeroLive.stopRequested.has(STORY)
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

describe("POST /api/stories/:storyId/generation", () => {
  test("a busy story is a 409 with the service's sentence", async () => {
    live.reserveRun(STORY, "someone-else")
    const res = await route.POST(
      request("POST", { kind: "do", userText: "I wait.", turnId: "t-1" }),
      params
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      ok: false,
      code: "conflict",
      error: "A generation is already running for this story.",
    })
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([])
  })

  test("a schema failure is a 400", async () => {
    const res = await route.POST(
      request("POST", { kind: "shout", userText: "x" }),
      params
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Unknown action kind.")
    expect(live.isRunActive(STORY)).toBe(false)
  })

  test("a body that is not a JSON object is refused, not read as Continue", async () => {
    for (const body of [["kind"], "continue", null]) {
      const res = await route.POST(request("POST", body), params)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe("invalid")
    }
    const res = await route.POST(
      new Request(ENDPOINT, { method: "POST", body: "{" }),
      params
    )
    expect(res.status).toBe(400)
    expect(live.isRunActive(STORY)).toBe(false)
  })
})

describe("DELETE /api/stories/:storyId/generation", () => {
  test("with no body, answers ok and aborts nothing it does not own", async () => {
    live.reserveRun(STORY, "turn-1")
    const res = await route.DELETE(
      new Request(ENDPOINT, { method: "DELETE" }),
      params
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: null })
    expect(stopLatched()).toBe(false)
  })

  test("a start's turnId latches a stop on that start's reservation", async () => {
    live.reserveRun(STORY, "turn-1")
    const res = await route.DELETE(
      request("DELETE", { runId: null, startTurnId: "turn-1" }),
      params
    )
    expect(res.status).toBe(200)
    expect(stopLatched()).toBe(true)
  })
})
