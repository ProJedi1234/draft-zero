import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from "bun:test"
import { worldPrefix } from "@/lib/world/fold"
import { eq } from "drizzle-orm"
import { closeDb, getDb, migrateOnce, truncateAll } from "./harness"
const { createStory, updateStoryMeta } = await import("@/lib/services/stories")
const { createLorebookEntry, deleteLorebookEntry } =
  await import("@/lib/services/lorebook")
const { applyWorldPatch, getWorldState } = await import("@/lib/services/world")
const { undoStoryOp, redoStoryOp, selectVariantByOffset } =
  await import("@/lib/services/history")
const { rewindToEntry, deleteEntry } = await import("@/lib/services/entries")
const { persistGeneratedEntry } = await import("@/lib/db/entry-writes")
const { worldPatches, stories } = await import("@/lib/db/schema")
const { liveWorldIo } = await import("@/lib/generation/world")
const { NO_ORIGIN } = await import("@/lib/services/context")
const { subscribeBus } = await import("@/lib/sync/bus")
let storyId: string, npcId: string
beforeAll(migrateOnce)
afterAll(closeDb)
beforeEach(async () => {
  await truncateAll()
  const created = await createStory({ title: "World history" }, NO_ORIGIN)
  if (!created.ok) throw new Error(created.error)
  storyId = created.data.id
  await updateStoryMeta(
    {
      id: storyId,
      patch: { features: { world: { enabled: true, pacing: "" } } },
    },
    NO_ORIGIN
  )
  const npc = await createLorebookEntry(
    { storyId, name: "Vell", keys: ["Vell"], category: "character", npc: true },
    NO_ORIGIN
  )
  if (!npc.ok) throw new Error(npc.error)
  npcId = npc.data.record.id
})
async function narrate(text: string, variantGroupId?: string) {
  const result = await persistGeneratedEntry(storyId, text, { variantGroupId })
  if (!result.ok) throw new Error(result.error)
  return result.data.entry
}
async function state() {
  const result = await getWorldState({ storyId }, NO_ORIGIN)
  if (!result.ok) throw new Error(result.error)
  return result.data.state
}
async function patch(entryId: string, minutes: number) {
  const data = await liveWorldIo.load(storyId)
  const entry = data.entries.find((e) => e.id === entryId)!
  return liveWorldIo.store(
    storyId,
    entryId,
    [
      { type: "advance-clock", minutes },
      {
        type: "add-memory",
        loreEntryId: npcId,
        memory: {
          id: crypto.randomUUID(),
          text: `I heard ${minutes} bells.`,
          importance: 3,
        },
      },
    ],
    worldPrefix(data.entries, data.patches, entry.position).revision
  )
}
test("real retry, switch-take, rewind, undo, redo and delete select the world's live patches", async () => {
  const nullPatch = await applyWorldPatch(
    { storyId, ops: [{ type: "set-clock", minutes: 2 }] },
    NO_ORIGIN
  )
  expect(nullPatch.ok).toBe(true)
  const first = await narrate("Vell hears two bells.")
  expect(await patch(first.id, 3)).toBe(true)
  const second = await narrate("Vell hears four bells.")
  expect(await patch(second.id, 4)).toBe(true)
  expect((await state()).minutes).toBe(9)
  const retry = await narrate("Vell waits ten minutes.", second.variantGroupId)
  expect(await patch(retry.id, 10)).toBe(true)
  expect((await state()).minutes).toBe(15)
  await undoStoryOp({ storyId }, NO_ORIGIN)
  expect((await state()).minutes).toBe(9)
  await redoStoryOp({ storyId }, NO_ORIGIN)
  expect((await state()).minutes).toBe(15)
  const switched = await selectVariantByOffset(
    { storyId, entryId: retry.id, offset: -1 },
    NO_ORIGIN
  )
  expect(switched.ok).toBe(true)
  expect((await state()).minutes).toBe(9)
  await rewindToEntry({ storyId, entryId: first.id }, NO_ORIGIN)
  expect((await state()).minutes).toBe(5)
  await undoStoryOp({ storyId }, NO_ORIGIN)
  expect((await state()).minutes).toBe(9)
  await deleteEntry({ storyId, entryId: first.id }, NO_ORIGIN)
  expect((await state()).minutes).toBe(6)
  await undoStoryOp({ storyId }, NO_ORIGIN)
  expect((await state()).minutes).toBe(9)
  expect((await state()).npcs[0].memories.map((m) => m.entryId)).toEqual([
    first.id,
    second.id,
  ])
  await deleteLorebookEntry({ id: npcId }, NO_ORIGIN)
  expect((await state()).npcs).toEqual([])
})
test("partial unique index dedupes world passes but allows manual patches; stale takes are refused", async () => {
  const entry = await narrate("Vell waits.")
  expect(await patch(entry.id, 5)).toBe(true)
  expect(await patch(entry.id, 5)).toBe(false)
  await applyWorldPatch(
    { storyId, ops: [{ type: "set-clock", minutes: 8 }] },
    NO_ORIGIN
  )
  await applyWorldPatch(
    {
      storyId,
      ops: [{ type: "set-mind", loreEntryId: npcId, mind: "I want to leave." }],
    },
    NO_ORIGIN
  )
  expect((await state()).minutes).toBe(8)
  expect((await state()).npcs[0].mind).toBe("I want to leave.")
  await deleteEntry({ storyId, entryId: entry.id }, NO_ORIGIN)
  expect(await patch(entry.id, 100)).toBe(false)
  expect((await state()).minutes).toBe(0)
  const db = await getDb()
  expect(
    await db
      .select()
      .from(worldPatches)
      .where(eq(worldPatches.storyId, storyId))
  ).toHaveLength(3)
})
test("manual patch publishes after commit and story deletion cascades patches", async () => {
  const db = await getDb()
  const seen: Promise<number>[] = []
  const stop = subscribeBus((event) => {
    if (event.kind === "change" && event.storyId === storyId)
      seen.push(state().then((s) => s.minutes))
  })
  try {
    await applyWorldPatch(
      { storyId, ops: [{ type: "set-clock", minutes: 42 }] },
      NO_ORIGIN
    )
    expect(await Promise.all(seen)).toEqual([42])
  } finally {
    stop()
  }
  await db.delete(stories).where(eq(stories.id, storyId))
  expect(
    await db
      .select()
      .from(worldPatches)
      .where(eq(worldPatches.storyId, storyId))
  ).toEqual([])
})

test("duplication copies feature and NPC flags, leaving patches behind without an id map", async () => {
  const entry = await narrate("Vell waits five minutes.")
  await patch(entry.id, 5)
  const { duplicateStory } = await import("@/lib/services/stories")
  const copied = await duplicateStory({ id: storyId }, NO_ORIGIN)
  if (!copied.ok) throw new Error(copied.error)
  expect(copied.data.record.features).toEqual({
    world: { enabled: true, pacing: "" },
  })
  const result = await getWorldState({ storyId: copied.data.id }, NO_ORIGIN)
  if (!result.ok) throw new Error(result.error)
  expect(result.data.state.minutes).toBe(0)
  expect(result.data.state.npcs).toHaveLength(1)
  expect(result.data.state.npcs[0]).toMatchObject({
    name: "Vell",
    memories: [],
    mind: "",
  })
  expect(result.data.state.npcs[0].loreEntryId).not.toBe(npcId)
})

async function revision(entryId: string) {
  const data = await liveWorldIo.load(storyId)
  return worldPrefix(
    data.entries,
    data.patches,
    data.entries.find((e) => e.id === entryId)!.position
  ).revision
}

test("a manual correction during a pass precedes its late commit but wins the fold", async () => {
  const entry = await narrate("Vell hears bells at dawn.")
  const before = await revision(entry.id)
  await applyWorldPatch(
    {
      storyId,
      ops: [
        { type: "set-clock", minutes: 1234 },
        { type: "set-mind", loreEntryId: npcId, mind: "Corrected" },
      ],
    },
    NO_ORIGIN
  )
  expect(
    await liveWorldIo.store(
      storyId,
      entry.id,
      [
        { type: "set-clock", minutes: 360 },
        { type: "set-mind", loreEntryId: npcId, mind: "Late answer" },
      ],
      before
    )
  ).toBe(true)
  const folded = await state()
  expect(folded.minutes).toBe(1234)
  expect(folded.npcs[0].mind).toBe("Corrected")
})

test("prefix patch and live-take changes reject stale answers without inserting", async () => {
  const first = await narrate("Vell listens.")
  const second = await narrate("Vell waits.")
  const beforePatch = await revision(second.id)
  await patch(first.id, 20)
  expect(
    await liveWorldIo.store(
      storyId,
      second.id,
      [{ type: "advance-clock", minutes: 3 }],
      beforePatch
    )
  ).toBe("stale")
  const beforeTake = await revision(second.id)
  await narrate("Vell leaves instead.", first.variantGroupId)
  expect(
    await liveWorldIo.store(
      storyId,
      second.id,
      [{ type: "advance-clock", minutes: 3 }],
      beforeTake
    )
  ).toBe("stale")
  const db = await getDb()
  expect(
    await db
      .select()
      .from(worldPatches)
      .where(eq(worldPatches.entryId, second.id))
  ).toEqual([])
  expect(
    await liveWorldIo.store(
      storyId,
      second.id,
      [{ type: "advance-clock", minutes: 3 }],
      await revision(second.id)
    )
  ).toBe(true)
})

test("a prefix correction committed under the story lock makes a waiting world store stale", async () => {
  const first = await narrate("Vell listens.")
  const second = await narrate("Vell waits.")
  const before = await revision(second.id)
  const db = await getDb()
  let waiting!: Promise<boolean | "stale">
  await db.transaction(async (tx) => {
    await tx.select().from(stories).where(eq(stories.id, storyId)).for("update")
    waiting = liveWorldIo.store(
      storyId,
      second.id,
      [{ type: "advance-clock", minutes: 3 }],
      before
    )
    await tx.insert(worldPatches).values({
      id: crypto.randomUUID(),
      storyId,
      entryId: first.id,
      source: "manual",
      opsJson: JSON.stringify([{ type: "set-clock", minutes: 800 }]),
      createdAt: new Date().toISOString(),
    })
  })
  expect(await waiting).toBe("stale")
  expect((await state()).minutes).toBe(800)
})

test("getStory skips malformed JSON and invalid world ops without losing valid state", async () => {
  const { getStory } = await import("@/lib/db/queries")
  const entry = await narrate("Vell waits.")
  await patch(entry.id, 42)
  const db = await getDb()
  const quiet = spyOn(console, "error").mockImplementation(() => {})
  try {
    for (const opsJson of [
      "{broken",
      JSON.stringify([{ type: "set-clock", minutes: -1 }]),
    ])
      await db.insert(worldPatches).values({
        id: crypto.randomUUID(),
        storyId,
        entryId: entry.id,
        source: "manual",
        opsJson,
        createdAt: new Date().toISOString(),
      })
    const story = await getStory(storyId)
    expect(story?.world?.minutes).toBe(42)
    expect(story?.world?.npcs[0].memories).toHaveLength(1)
    expect(quiet).toHaveBeenCalledTimes(2)
  } finally {
    quiet.mockRestore()
  }
})
