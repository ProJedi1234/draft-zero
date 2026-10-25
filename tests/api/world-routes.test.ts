import { beforeEach, expect, test } from "bun:test"
import { installFakeDb } from "@/lib/services/test-support"
const db = installFakeDb()
const read = await import("@/app/api/stories/[storyId]/world/route")
const write = await import("@/app/api/stories/[storyId]/world/patch/route")
const { reserveRun, releaseRun } = await import("@/lib/generation/live")
const params = { params: Promise.resolve({ storyId: "world-route-tests" }) }
beforeEach(() => db.reset())
const req = (body: unknown) =>
  new Request("http://local/api/stories/world-route-tests/world/patch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
function script() {
  db.next([{ id: "world-route-tests" }])
  db.next([])
  db.next([])
  db.next([])
}
test("GET world returns the service result", async () => {
  script()
  const result = await read.GET(new Request("http://local/world"), params)
  expect(result.status).toBe(200)
  expect(await result.json()).toEqual({
    ok: true,
    data: { state: { storyId: "world-route-tests", minutes: 0, npcs: [] } },
  })
})
test("POST world patch returns the folded state", async () => {
  script()
  const result = await write.POST(
    req({ ops: [{ type: "set-clock", minutes: 75 }] }),
    params
  )
  expect(result.status).toBe(200)
  expect((await result.json()).data.state.minutes).toBe(75)
})
test("world routes map not_found, invalid and malformed JSON", async () => {
  expect(
    (await read.GET(new Request("http://local/world"), params)).status
  ).toBe(404)
  expect(
    (
      await write.POST(
        req({ ops: [{ type: "set-clock", minutes: 0 }] }),
        params
      )
    ).status
  ).toBe(404)
  expect(
    (
      await write.POST(
        req({ ops: [{ type: "advance-clock", minutes: 1 }] }),
        params
      )
    ).status
  ).toBe(400)
  expect((await write.POST(req({}), params)).status).toBe(400)
  expect(
    (
      await write.POST(
        new Request("http://local", { method: "POST", body: "{" }),
        params
      )
    ).status
  ).toBe(400)
})
test("POST refuses a live run with HTTP 409", async () => {
  expect(reserveRun("world-route-tests")).toBe(true)
  try {
    expect(
      (
        await write.POST(
          req({ ops: [{ type: "set-clock", minutes: 0 }] }),
          params
        )
      ).status
    ).toBe(409)
  } finally {
    releaseRun("world-route-tests")
  }
})
