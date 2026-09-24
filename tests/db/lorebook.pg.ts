// tests/db/lorebook.pg.ts — the lorebook failures only a real Postgres
// produces: the story foreign key and the integer priority column. See
// tests/db/harness.ts for how to run it.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"

import { closeDb, migrateOnce, truncateAll } from "./harness"

const { NO_ORIGIN } = await import("@/lib/services/context")
const { createLorebookEntry, updateLorebookEntry } =
  await import("@/lib/services/lorebook")
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

describe("createLorebookEntry", () => {
  test("a story that does not exist is not_found, not a thrown FK error", async () => {
    const result = await createLorebookEntry(
      { storyId: crypto.randomUUID(), name: "Gull" },
      NO_ORIGIN
    )
    expect(result).toEqual({
      ok: false,
      code: "not_found",
      error: "Story not found.",
    })
  })

  test("a fractional priority is refused before it reaches the integer column", async () => {
    const created = await createLorebookEntry(
      { storyId, name: "Gull" },
      NO_ORIGIN
    )
    if (!created.ok) throw new Error(created.error)
    const result = await updateLorebookEntry(
      { id: created.data.record.id, patch: { priority: 50.5 } },
      NO_ORIGIN
    )
    expect(result).toMatchObject({ ok: false, code: "invalid" })
  })
})
