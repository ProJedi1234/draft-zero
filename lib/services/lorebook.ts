// lib/services/lorebook.ts — Lorebook writes, callable from a server action,
// a route handler or an MCP tool alike.
import "server-only"

import { eq } from "drizzle-orm"

import { getDb } from "@/lib/db/client"
import { toLorebookEntry } from "@/lib/db/mappers"
import { lorebookEntries } from "@/lib/db/schema"
import {
  commitLorebookDelete,
  commitLorebookUpsert,
} from "@/lib/services/commit"
import type { ServiceContext } from "@/lib/services/context"
import {
  createLorebookEntryInput,
  deleteLorebookEntryInput,
  updateLorebookEntryInput,
  type CreateLorebookEntryInput,
  type DeleteLorebookEntryInput,
  type UpdateLorebookEntryInput,
} from "@/lib/services/lorebook.schema"
import { fail, ok, parseInput, type ServiceResult } from "@/lib/services/result"
import type { LorebookEntry } from "@/lib/types"

/**
 * Every mutator returns the row it wrote. That is what lets the client confirm
 * an optimistic patch against server truth instead of re-reading: the record
 * carries the server-minted updated_at the whole store arbitrates on, so the
 * confirm and the bus echo of the same write are the same fact and fold
 * idempotently.
 */
export async function createLorebookEntry(
  raw: CreateLorebookEntryInput,
  ctx: ServiceContext
): Promise<ServiceResult<{ record: LorebookEntry }>> {
  const parsed = parseInput(createLorebookEntryInput, raw)
  if (!parsed.ok) return parsed
  const input = parsed.data

  const id = input.id ?? crypto.randomUUID()
  const db = await getDb()
  const now = new Date().toISOString()

  const inserted = await db
    .insert(lorebookEntries)
    .values({
      id,
      storyId: input.storyId,
      name: input.name,
      category: input.category,
      keysJson: JSON.stringify(input.keys),
      content: input.content,
      enabled: input.enabled,
      alwaysActive: input.alwaysActive,
      priority: input.priority,
      createdAt: now,
      updatedAt: now,
    })
    // The retry's landing pad: the same id arriving twice is one write, and the
    // row already there is the answer both attempts wanted.
    .onConflictDoNothing({ target: lorebookEntries.id })
    .returning()

  const row = inserted[0] ?? (await readRow(id))
  if (row === undefined) return fail("not_found", "Lorebook entry not found.")

  const record = toLorebookEntry(row)
  commitLorebookUpsert(record, ctx.origin)
  return ok({ record })
}

/** Patch any mutable field. Bumps updated_at, which is the row's version. */
export async function updateLorebookEntry(
  raw: UpdateLorebookEntryInput,
  ctx: ServiceContext
): Promise<ServiceResult<{ record: LorebookEntry }>> {
  const parsed = parseInput(updateLorebookEntryInput, raw)
  if (!parsed.ok) return parsed
  const { id, patch } = parsed.data

  const values: Partial<typeof lorebookEntries.$inferInsert> = {}
  if (patch.name !== undefined) values.name = patch.name
  if (patch.category !== undefined) values.category = patch.category
  if (patch.keys !== undefined) values.keysJson = JSON.stringify(patch.keys)
  if (patch.content !== undefined) values.content = patch.content
  if (patch.enabled !== undefined) values.enabled = patch.enabled
  if (patch.alwaysActive !== undefined) values.alwaysActive = patch.alwaysActive
  if (patch.priority !== undefined) values.priority = patch.priority

  const db = await getDb()
  const updated = await db
    .update(lorebookEntries)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(lorebookEntries.id, id))
    .returning()

  const row = updated[0]
  if (row === undefined) return fail("not_found", "Lorebook entry not found.")

  const record = toLorebookEntry(row)
  commitLorebookUpsert(record, ctx.origin)
  return ok({ record })
}

export async function deleteLorebookEntry(
  raw: DeleteLorebookEntryInput,
  ctx: ServiceContext
): Promise<ServiceResult<{ storyId: string; version: string }>> {
  const parsed = parseInput(deleteLorebookEntryInput, raw)
  if (!parsed.ok) return parsed
  const { id } = parsed.data

  const db = await getDb()
  const deleted = await db
    .delete(lorebookEntries)
    .where(eq(lorebookEntries.id, id))
    .returning({ storyId: lorebookEntries.storyId })

  const row = deleted[0]
  if (row === undefined) return fail("not_found", "Lorebook entry not found.")

  // A delete leaves no row to read a version off, so the deleting clock is the
  // version. It only has to beat upserts already in flight; the next partition
  // snapshot re-proves the absence either way.
  const version = new Date().toISOString()
  commitLorebookDelete(id, row.storyId, version, ctx.origin)
  return ok({ storyId: row.storyId, version })
}

async function readRow(id: string) {
  const db = await getDb()
  const rows = await db
    .select()
    .from(lorebookEntries)
    .where(eq(lorebookEntries.id, id))
  return rows[0]
}
