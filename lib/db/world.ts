import { eq } from "drizzle-orm"

import type { DrizzleDb, DrizzleTx } from "@/lib/db/client"
import { toLorebookEntry } from "@/lib/db/mappers"
import { lorebookEntries, storyEntries, worldPatches } from "@/lib/db/schema"
import { worldOp } from "@/lib/services/world.schema"
import { foldWorld, type WorldPatch } from "@/lib/world/fold"

export async function readWorldData(
  db: DrizzleDb | DrizzleTx,
  storyId: string
) {
  const entries = await db
    .select({
      id: storyEntries.id,
      position: storyEntries.position,
      variantGroupId: storyEntries.variantGroupId,
      isActive: storyEntries.isActive,
      deletedAt: storyEntries.deletedAt,
      source: storyEntries.source,
    })
    .from(storyEntries)
    .where(eq(storyEntries.storyId, storyId))
  const lore = (
    await db
      .select()
      .from(lorebookEntries)
      .where(eq(lorebookEntries.storyId, storyId))
  ).map(toLorebookEntry)
  const rows = await db
    .select()
    .from(worldPatches)
    .where(eq(worldPatches.storyId, storyId))
  const patches: WorldPatch[] = []
  for (const row of rows) {
    let ops: unknown
    try {
      ops = JSON.parse(row.opsJson)
    } catch {
      console.error("[world] invalid patch JSON", row.id)
      continue
    }
    const parsed = worldOp.array().safeParse(ops)
    if (!parsed.success) {
      console.error("[world] invalid patch ops", row.id)
      continue
    }
    patches.push({ ...row, ops: parsed.data })
  }
  return {
    entries,
    lore,
    patches,
    state: foldWorld(storyId, entries, lore, patches),
  }
}
