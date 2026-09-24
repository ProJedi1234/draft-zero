// tests/db/generation.pg.ts — startGeneration against a real Postgres: every
// refusal hands the story's reservation back, and a turn launches a run on the
// mock provider. See tests/db/harness.ts for how to run it.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"

import { closeDb, migrateOnce, truncateAll } from "./harness"

const { isRunActive, releaseRun, reserveRun } =
  await import("@/lib/generation/live")
const { NO_ORIGIN } = await import("@/lib/services/context")
const { startGeneration, stopGeneration } =
  await import("@/lib/services/generation")
const { createStory } = await import("@/lib/services/stories")

let storyId: string

beforeAll(migrateOnce)
afterAll(closeDb)

beforeEach(async () => {
  await truncateAll()
  const created = await createStory({ title: "Harbour" }, NO_ORIGIN)
  if (!created.ok) throw new Error(created.error)
  storyId = created.data.id
})

describe("startGeneration", () => {
  test("a missing story is not_found and releases the reservation", async () => {
    const missing = crypto.randomUUID()
    const result = await startGeneration({ storyId: missing }, NO_ORIGIN)
    expect(result).toEqual({
      ok: false,
      code: "not_found",
      error: "Story not found.",
    })
    expect(reserveRun(missing, null)).toBe(true)
    releaseRun(missing)
  })

  test("an unknown profile is not_found and releases the reservation", async () => {
    const result = await startGeneration(
      { storyId, profileId: crypto.randomUUID() },
      NO_ORIGIN
    )
    expect(result).toEqual({
      ok: false,
      code: "not_found",
      error: "That profile is no longer available.",
    })
    expect(reserveRun(storyId, null)).toBe(true)
    releaseRun(storyId)
  })

  test("a turn appends the user's entry and launches a run", async () => {
    const result = await startGeneration(
      { storyId, kind: "do", userText: "open the door" },
      NO_ORIGIN
    )
    if (!result.ok) throw new Error(result.error)
    expect(result.data.runId).toEqual(expect.any(String))
    expect(result.data.userEntryId).toEqual(expect.any(String))

    await stopGeneration({ storyId, runId: result.data.runId }, NO_ORIGIN)
    for (let i = 0; i < 100 && isRunActive(storyId); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(isRunActive(storyId)).toBe(false)
  })
})
