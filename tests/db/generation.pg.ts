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
const { createStory, updateGenerationSettings } =
  await import("@/lib/services/stories")
const { setStoryProfile } = await import("@/lib/services/profiles")
const { getStory } = await import("@/lib/db/queries")

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

  test("an unknown model releases the reservation without changing the story", async () => {
    const before = await getStory(storyId)
    const result = await startGeneration(
      { storyId, modelId: "missing/model" },
      NO_ORIGIN
    )
    expect(result).toEqual({
      ok: false,
      code: "not_found",
      error: "That model is no longer available.",
    })
    expect(isRunActive(storyId)).toBe(false)
    expect(await getStory(storyId)).toEqual(before)
  })

  test("a model override cannot bypass the story's retention policy", async () => {
    await setStoryProfile({ storyId, profileId: null }, NO_ORIGIN)
    await updateGenerationSettings(
      { id: storyId, patch: { zdr: true } },
      NO_ORIGIN
    )
    const result = await startGeneration(
      { storyId, modelId: "~moonshotai/kimi-latest" },
      NO_ORIGIN
    )
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "That model has no zero-retention provider.",
    })
    expect(isRunActive(storyId)).toBe(false)
  })

  test("a custom-model retry keeps the old take and the story's settings", async () => {
    await setStoryProfile({ storyId, profileId: null }, NO_ORIGIN)
    await updateGenerationSettings(
      { id: storyId, patch: { thinking: "medium", temperature: 0.7 } },
      NO_ORIGIN
    )
    const first = await startGeneration(
      { storyId, requestKind: "continue" },
      NO_ORIGIN
    )
    if (!first.ok) throw new Error(first.error)
    await waitForRun()
    const before = (await getStory(storyId))!
    const oldTake = before.entries.at(-1)!
    const retried = await startGeneration(
      {
        storyId,
        requestKind: "retry",
        modelId: "~moonshotai/kimi-latest",
        variantGroupId: oldTake.variantGroupId,
        removingEntryIds: [oldTake.id],
      },
      NO_ORIGIN
    )
    if (!retried.ok) throw new Error(retried.error)
    await waitForRun()
    const after = (await getStory(storyId))!
    const take = after.entries.at(-1)!
    expect(take.id).not.toBe(oldTake.id)
    expect(take.variantGroupId).toBe(oldTake.variantGroupId)
    expect(take.variantCount).toBe(2)
    expect(take.generation).toMatchObject({
      modelId: "~moonshotai/kimi-latest",
      thinking: "off",
      temperature: 0.7,
      profileName: null,
    })
    expect(after.settings).toEqual(before.settings)
    expect(after.profileId).toBe(before.profileId)
  }, 15000)

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

async function waitForRun() {
  for (let i = 0; i < 500 && isRunActive(storyId); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  expect(isRunActive(storyId)).toBe(false)
}
