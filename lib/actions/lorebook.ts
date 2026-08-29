"use server"

import { eq } from "drizzle-orm"

import { commitChange } from "@/lib/actions/commit"
import { getDb } from "@/lib/db/client"
import { lorebookEntries } from "@/lib/db/schema"
import type { ActionResult, NewLorebookEntry } from "@/lib/types"

export async function createLorebookEntry(
  storyId: string,
  input: NewLorebookEntry
): Promise<ActionResult<{ id: string }>> {
  const name = input.name.trim()
  if (name === "") return { ok: false, error: "Name is required." }

  const db = await getDb()
  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  await db.insert(lorebookEntries).values({
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

  commitChange(storyId)
  return { ok: true, data: { id } }
}

/** Patch any mutable field. Bumps updated_at. */
export async function updateLorebookEntry(
  id: string,
  patch: Partial<NewLorebookEntry>
): Promise<ActionResult> {
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
    .returning({ id: lorebookEntries.id })

  if (updated.length === 0)
    return { ok: false, error: "Lorebook entry not found." }

  commitChange(null, ["lorebook-entry"])
  return { ok: true, data: null }
}

export async function deleteLorebookEntry(id: string): Promise<ActionResult> {
  const db = await getDb()
  const deleted = await db
    .delete(lorebookEntries)
    .where(eq(lorebookEntries.id, id))
    .returning({ id: lorebookEntries.id })

  if (deleted.length === 0)
    return { ok: false, error: "Lorebook entry not found." }

  commitChange(null, ["lorebook-entry"])
  return { ok: true, data: null }
}
