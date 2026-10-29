// tests/db/cost.pg.ts — The story ledger's purpose and per-turn reads, and the
// migration that links old world passes to their passages, against Postgres.
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { eq, sql } from "drizzle-orm"

import type { GenerationRequestKind } from "@/lib/types"

import { closeDb, getDb, migrateOnce, truncateAll } from "./harness"

const { createStory } = await import("@/lib/services/stories")
const { persistGeneratedEntry } = await import("@/lib/db/entry-writes")
const { getStoryCostProfile } = await import("@/lib/db/cost-queries")
const { generationCalls, worldPatches } = await import("@/lib/db/schema")
const { NO_ORIGIN } = await import("@/lib/services/context")

let storyId: string

beforeAll(migrateOnce)
afterAll(closeDb)
beforeEach(async () => {
  await truncateAll()
  const created = await createStory({ title: "Ledger" }, NO_ORIGIN)
  if (!created.ok) throw new Error(created.error)
  storyId = created.data.id
})

async function narrate(text: string) {
  const result = await persistGeneratedEntry(storyId, text, {})
  if (!result.ok) throw new Error(result.error)
  return result.data.entry
}

let clock = 0
async function call(
  requestKind: GenerationRequestKind,
  costUsd: string | null,
  extra: Partial<typeof generationCalls.$inferInsert> = {}
) {
  const db = await getDb()
  const createdAt = new Date(
    Date.UTC(2026, 9, 28, 12, 0, clock++)
  ).toISOString()
  await db.insert(generationCalls).values({
    id: crypto.randomUUID(),
    storyId,
    origStoryId: storyId,
    requestKind,
    modelId: requestKind === "world" ? "haiku" : "glm",
    status: "ok",
    costUsd,
    createdAt,
    settledAt: createdAt,
    ...extra,
  })
}

test("groups spend by purpose, line and model, and by the slot each call served", async () => {
  const a = await narrate("First passage.")
  const b = await narrate("Second passage.")
  await call("generate", "0.010", { origVariantGroupId: a.variantGroupId })
  await call("retry", "0.020", {
    origVariantGroupId: a.variantGroupId,
    modelId: "sonnet",
  })
  // Stopped before it became a passage: in the totals, not on the turn.
  await call("retry", null, { status: "aborted" })
  await call("world", "0.003", { subjectGroupId: a.variantGroupId })
  await call("generate", "0.005", { origVariantGroupId: b.variantGroupId })
  await call("world", "0.004", { subjectGroupId: b.variantGroupId })
  await call("summarize", "0.001")
  await call("atmosphere", "0")
  await call("illustrate", "0.040")
  await call("illustrate-prompt", "0.002")
  await call("generate", null, { status: "streaming" })

  const profile = await getStoryCostProfile(storyId)

  expect(profile.perPurpose.map((row) => row.purpose)).toEqual([
    "story",
    "pictures",
    "memory",
    "atmosphere",
  ])
  const [story, pictures, memory] = profile.perPurpose
  expect(story).toMatchObject({
    costUsd: "0.035000000000",
    calls: 4,
    unpricedCalls: 1,
  })
  expect(story.parts).toEqual([
    { part: "take", costUsd: "0.015000000000", calls: 2, unpricedCalls: 0 },
    { part: "reroll", costUsd: "0.020000000000", calls: 2, unpricedCalls: 1 },
  ])
  expect(story.models.map((m) => [m.modelId, m.costUsd])).toEqual([
    ["sonnet", "0.020000000000"],
    ["glm", "0.015000000000"],
  ])
  expect(pictures.parts.map((p) => p.part)).toEqual(["image", "image-prompt"])
  expect(memory.parts).toEqual([
    { part: "world", costUsd: "0.007000000000", calls: 2, unpricedCalls: 0 },
    { part: "recap", costUsd: "0.001000000000", calls: 1, unpricedCalls: 0 },
  ])
  expect(memory.models.map((m) => m.modelId).sort()).toEqual(["glm", "haiku"])

  expect(profile.perTurn).toEqual([
    {
      entryId: a.id,
      position: a.position!,
      takeUsd: "0.010000000000",
      rerollUsd: "0.020000000000",
      rerolls: 1,
      worldUsd: "0.003000000000",
      unpricedCalls: 0,
    },
    {
      entryId: b.id,
      position: b.position!,
      takeUsd: "0.005000000000",
      rerollUsd: null,
      rerolls: 0,
      worldUsd: "0.004000000000",
      unpricedCalls: 0,
    },
  ])
})

test("a passage with no ledger rows is a turn of unknown cost, not an unpriced call", async () => {
  await narrate("Imported.")
  const profile = await getStoryCostProfile(storyId)
  expect(profile.perPurpose).toEqual([])
  expect(profile.perTurn).toHaveLength(1)
  expect(profile.perTurn[0]).toMatchObject({
    takeUsd: null,
    rerolls: 0,
    unpricedCalls: 0,
  })
})

test("the migration links a world pass to the patch it stored, and nothing else", async () => {
  const a = await narrate("Linked.")
  const db = await getDb()
  const at = (s: number) =>
    new Date(Date.UTC(2026, 9, 28, 12, 0, s)).toISOString()
  await db.insert(worldPatches).values({
    id: crypto.randomUUID(),
    storyId,
    entryId: a.id,
    source: "world",
    opsJson: "[]",
    createdAt: at(5),
  })
  await call("world", "0.003", { createdAt: at(4), settledAt: at(6) })
  // Failed before storing anything: its window holds no patch.
  await call("world", "0.001", { createdAt: at(7), settledAt: at(8) })

  const backfill = readFileSync(
    "drizzle/0033_ledger_subject_group.sql",
    "utf8"
  ).split("--> statement-breakpoint")[1]
  await db.execute(sql.raw(backfill))

  const rows = await db
    .select({
      costUsd: generationCalls.costUsd,
      subject: generationCalls.subjectGroupId,
    })
    .from(generationCalls)
    .where(eq(generationCalls.requestKind, "world"))
    .orderBy(generationCalls.createdAt)
  expect(rows).toEqual([
    { costUsd: "0.003000000000", subject: a.variantGroupId },
    { costUsd: "0.001000000000", subject: null },
  ])
})
