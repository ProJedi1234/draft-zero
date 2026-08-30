"use server"

import { eq } from "drizzle-orm"

import {
  commitLorebookDelete,
  commitLorebookUpsert,
} from "@/lib/actions/commit"
import { getDb } from "@/lib/db/client"
import { toLorebookEntry } from "@/lib/db/mappers"
import { lorebookEntries } from "@/lib/db/schema"
import { isValidEntityId } from "@/lib/store/records"
import type { ActionResult, LorebookEntry, NewLorebookEntry } from "@/lib/types"

/** Who acted, so the bus echo can be ignored on the device that wrote it. */
type Origin = { origin?: string | null }

/**
 * Every mutator returns the row it wrote. That is what lets the client confirm
 * an optimistic patch against server truth instead of re-reading: the record
 * carries the server-minted updated_at the whole store arbitrates on, so the
 * confirm and the bus echo of the same write are the same fact and fold
 * idempotently.
 */
export async function createLorebookEntry(
  storyId: string,
  input: NewLorebookEntry,
  // The client mints the id so it can paint the row before this returns, and so
  // a retry after a lost response confirms the write that landed rather than
  // failing on its primary key.
  options: Origin & { id?: string } = {}
): Promise<ActionResult<{ record: LorebookEntry }>> {
  if (!isValidEntityId(storyId))
    return { ok: false, error: "Invalid story id." }

  const name = input.name.trim()
  if (name === "") return { ok: false, error: "Name is required." }

  const id = options.id ?? crypto.randomUUID()
  if (!isValidEntityId(id)) return { ok: false, error: "Invalid entry id." }

  const db = await getDb()
  const now = new Date().toISOString()

  const inserted = await db
    .insert(lorebookEntries)
    .values({
      id,
      storyId,
      name,
      category: input.category,
      keysJson: JSON.stringify(input.keys ?? []),
      content: input.content ?? "",
      enabled: input.enabled ?? true,
      alwaysActive: input.alwaysActive ?? false,
      priority: input.priority ?? 50,
      createdAt: now,
      updatedAt: now,
    })
    // The retry's landing pad: the same id arriving twice is one write, and the
    // row already there is the answer both attempts wanted.
    .onConflictDoNothing({ target: lorebookEntries.id })
    .returning()

  const row = inserted[0] ?? (await readRow(id))
  if (row === undefined)
    return { ok: false, error: "Lorebook entry not found." }

  const record = toLorebookEntry(row)
  commitLorebookUpsert(record, options.origin ?? null)
  return { ok: true, data: { record } }
}

/** Patch any mutable field. Bumps updated_at, which is the row's version. */
export async function updateLorebookEntry(
  id: string,
  patch: Partial<NewLorebookEntry>,
  options: Origin = {}
): Promise<ActionResult<{ record: LorebookEntry }>> {
  if (!isValidEntityId(id)) return { ok: false, error: "Invalid entry id." }

  const values: Partial<typeof lorebookEntries.$inferInsert> = {}

  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (name === "") return { ok: false, error: "Name is required." }
    values.name = name
  }
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
  if (row === undefined)
    return { ok: false, error: "Lorebook entry not found." }

  const record = toLorebookEntry(row)
  commitLorebookUpsert(record, options.origin ?? null)
  return { ok: true, data: { record } }
}

export async function deleteLorebookEntry(
  id: string,
  options: Origin = {}
): Promise<ActionResult<{ storyId: string; version: string }>> {
  if (!isValidEntityId(id)) return { ok: false, error: "Invalid entry id." }

  const db = await getDb()
  const deleted = await db
    .delete(lorebookEntries)
    .where(eq(lorebookEntries.id, id))
    .returning({ storyId: lorebookEntries.storyId })

  const row = deleted[0]
  if (row === undefined)
    return { ok: false, error: "Lorebook entry not found." }

  // A delete leaves no row to read a version off, so the deleting clock is the
  // version. It only has to beat upserts already in flight; the next partition
  // snapshot re-proves the absence either way.
  const version = new Date().toISOString()
  commitLorebookDelete(id, row.storyId, version, options.origin ?? null)
  return { ok: true, data: { storyId: row.storyId, version } }
}

async function readRow(id: string) {
  const db = await getDb()
  const rows = await db
    .select()
    .from(lorebookEntries)
    .where(eq(lorebookEntries.id, id))
  return rows[0]
}
