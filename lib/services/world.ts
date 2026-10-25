import "server-only"

import { eq } from "drizzle-orm"

import { getDb } from "@/lib/db/client"
import { stories, worldPatches } from "@/lib/db/schema"
import { readWorldData } from "@/lib/db/world"
import { refuseDuringRun } from "@/lib/generation/live"
import { commitChange } from "@/lib/services/commit"
import type { Service } from "@/lib/services/context"
import { fail, ok, parseInput } from "@/lib/services/result"
import {
  applyWorldPatchInput,
  getWorldInput,
  type ApplyWorldPatchInput,
  type GetWorldInput,
  type WorldState,
} from "@/lib/services/world.schema"
import { foldWorld } from "@/lib/world/fold"

export const getWorldState: Service<
  GetWorldInput,
  { state: WorldState }
> = async (raw) => {
  const parsed = parseInput(getWorldInput, raw)
  if (!parsed.ok) return parsed
  const { storyId } = parsed.data
  const db = await getDb()
  return db.transaction(
    async (tx) => {
      const [story] = await tx
        .select({ id: stories.id })
        .from(stories)
        .where(eq(stories.id, storyId))
      if (!story) return fail("not_found", "Story not found.")
      const { state } = await readWorldData(tx, storyId)
      return ok({ state })
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  )
}

export const applyWorldPatch: Service<
  ApplyWorldPatchInput,
  { state: WorldState }
> = async (raw) => {
  const parsed = parseInput(applyWorldPatchInput, raw)
  if (!parsed.ok) return parsed
  const { storyId, ops } = parsed.data
  const busy = refuseDuringRun(storyId)
  if (busy) return fail("conflict", busy.error)
  const db = await getDb()
  const result = await db.transaction(async (tx) => {
    const [story] = await tx
      .select({ id: stories.id })
      .from(stories)
      .where(eq(stories.id, storyId))
      .for("update")
    if (!story) return fail("not_found", "Story not found.")
    const data = await readWorldData(tx, storyId)
    const busy = refuseDuringRun(storyId)
    if (busy) return fail("conflict", busy.error)
    const anchor = data.entries
      .filter(
        (e) => e.isActive && e.deletedAt === null && e.source === "generated"
      )
      .sort((a, b) => b.position - a.position)[0]
    const patch = {
      source: "manual" as const,
      id: crypto.randomUUID(),
      entryId: anchor?.id ?? null,
      ops,
      createdAt: new Date().toISOString(),
    }
    await tx.insert(worldPatches).values({
      id: patch.id,
      storyId,
      entryId: patch.entryId,
      source: "manual",
      opsJson: JSON.stringify(ops),
      createdAt: patch.createdAt,
    })
    return ok({
      state: foldWorld(storyId, data.entries, data.lore, [
        ...data.patches,
        patch,
      ]),
    })
  })
  if (result.ok) commitChange(storyId)
  return result
}
