"use server"

import { asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/lib/db/client"
import { getAppSettings } from "@/lib/db/queries"
import { lorebookEntries, stories, storyEntries } from "@/lib/db/schema"
import { DEFAULT_GENERATION_SETTINGS } from "@/lib/mock-data"
import type { ActionResult, GenerationSettings } from "@/lib/types"

/**
 * Creates a story with title "Untitled Story" (or given), empty text fields,
 * settings from the app default model + DEFAULT_GENERATION_SETTINGS numerics.
 */
export async function createStory(input?: {
  title?: string
}): Promise<ActionResult<{ id: string }>> {
  const db = await getDb()
  const appSettings = await getAppSettings()
  const now = new Date().toISOString()
  const title = input?.title?.trim() || "Untitled Story"
  const id = crypto.randomUUID()

  await db.insert(stories).values({
    id,
    title,
    description: "",
    genre: "",
    memory: "",
    authorsNote: "",
    modelId: appSettings.defaultModelId,
    thinking: DEFAULT_GENERATION_SETTINGS.thinking,
    temperature: DEFAULT_GENERATION_SETTINGS.temperature,
    topP: DEFAULT_GENERATION_SETTINGS.topP,
    maxTokens: DEFAULT_GENERATION_SETTINGS.maxTokens,
    frequencyPenalty: DEFAULT_GENERATION_SETTINGS.frequencyPenalty,
    presencePenalty: DEFAULT_GENERATION_SETTINGS.presencePenalty,
    createdAt: now,
    updatedAt: now,
  })

  revalidatePath("/", "layout")
  return { ok: true, data: { id } }
}

export async function renameStory(
  id: string,
  title: string
): Promise<ActionResult> {
  const trimmed = title.trim()
  if (trimmed === "") return { ok: false, error: "Title can't be empty." }

  const db = await getDb()
  const updated = await db
    .update(stories)
    .set({ title: trimmed, updatedAt: new Date().toISOString() })
    .where(eq(stories.id, id))
    .returning({ id: stories.id })

  if (updated.length === 0) return { ok: false, error: "Story not found." }

  revalidatePath("/", "layout")
  return { ok: true, data: null }
}

/** Patch any of the story text-metadata fields. Only supplied keys are written. */
export async function updateStoryMeta(
  id: string,
  patch: {
    title?: string
    description?: string
    genre?: string
    memory?: string
    authorsNote?: string
  }
): Promise<ActionResult> {
  const values: Partial<typeof stories.$inferInsert> = {}
  if (patch.title !== undefined) {
    const trimmed = patch.title.trim()
    if (trimmed === "") return { ok: false, error: "Title can't be empty." }
    values.title = trimmed
  }
  if (patch.description !== undefined) values.description = patch.description
  if (patch.genre !== undefined) values.genre = patch.genre
  if (patch.memory !== undefined) values.memory = patch.memory
  if (patch.authorsNote !== undefined) values.authorsNote = patch.authorsNote

  const db = await getDb()
  const updated = await db
    .update(stories)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(stories.id, id))
    .returning({ id: stories.id })

  if (updated.length === 0) return { ok: false, error: "Story not found." }

  revalidatePath("/", "layout")
  return { ok: true, data: null }
}

/** Full copy (entries + lorebook + settings), title suffixed " (copy)", fresh ids/timestamps. */
export async function duplicateStory(
  id: string
): Promise<ActionResult<{ id: string }>> {
  const db = await getDb()
  const source = await db
    .select()
    .from(stories)
    .where(eq(stories.id, id))
    .limit(1)
    .then((rows) => rows[0])

  if (!source) return { ok: false, error: "Story not found." }

  const [entries, lore] = await Promise.all([
    db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.storyId, id))
      .orderBy(asc(storyEntries.position)),
    db.select().from(lorebookEntries).where(eq(lorebookEntries.storyId, id)),
  ])

  const now = new Date().toISOString()
  const copyId = crypto.randomUUID()

  await db.insert(stories).values({
    ...source,
    id: copyId,
    title: `${source.title} (copy)`,
    createdAt: now,
    updatedAt: now,
  })

  if (entries.length > 0) {
    await db.insert(storyEntries).values(
      entries.map((entry, index) => ({
        id: crypto.randomUUID(),
        storyId: copyId,
        position: index,
        source: entry.source,
        text: entry.text,
        createdAt: now,
      }))
    )
  }

  // The lorebook is per-story, so a copy needs its own copy of the lore.
  if (lore.length > 0) {
    await db.insert(lorebookEntries).values(
      lore.map((entry) => ({
        ...entry,
        id: crypto.randomUUID(),
        storyId: copyId,
        createdAt: now,
        updatedAt: now,
      }))
    )
  }

  revalidatePath("/", "layout")
  return { ok: true, data: { id: copyId } }
}

export async function deleteStory(id: string): Promise<ActionResult> {
  const db = await getDb()
  // Child entries and lorebook entries go with it: Postgres enforces the
  // ON DELETE CASCADE declared on both story_id columns, so no explicit child
  // delete is needed.
  const deleted = await db
    .delete(stories)
    .where(eq(stories.id, id))
    .returning({ id: stories.id })

  if (deleted.length === 0) return { ok: false, error: "Story not found." }

  revalidatePath("/", "layout")
  return { ok: true, data: null }
}

export async function updateGenerationSettings(
  id: string,
  patch: Partial<GenerationSettings>
): Promise<ActionResult> {
  const values: Partial<typeof stories.$inferInsert> = {}
  if (patch.modelId !== undefined) values.modelId = patch.modelId
  if (patch.thinking !== undefined) values.thinking = patch.thinking
  if (patch.temperature !== undefined) values.temperature = patch.temperature
  if (patch.topP !== undefined) values.topP = patch.topP
  if (patch.maxTokens !== undefined) values.maxTokens = patch.maxTokens
  if (patch.frequencyPenalty !== undefined)
    values.frequencyPenalty = patch.frequencyPenalty
  if (patch.presencePenalty !== undefined)
    values.presencePenalty = patch.presencePenalty

  const db = await getDb()
  const updated = await db
    .update(stories)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(stories.id, id))
    .returning({ id: stories.id })

  if (updated.length === 0) return { ok: false, error: "Story not found." }

  revalidatePath("/", "layout")
  return { ok: true, data: null }
}
