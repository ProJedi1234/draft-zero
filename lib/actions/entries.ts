"use server"

import { and, desc, eq, gte, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import type { DrizzleDb } from "@/lib/db/client"
import { getDb } from "@/lib/db/client"
import { toStoryEntry } from "@/lib/db/mappers"
import { stories, storyEntries } from "@/lib/db/schema"
import { translateAction } from "@/lib/story/action-voice"
import type {
  ActionKind,
  ActionResult,
  EntrySource,
  StoryEntry,
} from "@/lib/types"

async function storyExists(db: DrizzleDb, storyId: string): Promise<boolean> {
  const row = await db
    .select({ id: stories.id })
    .from(stories)
    .where(eq(stories.id, storyId))
    .limit(1)
    .then((rows) => rows[0])
  return Boolean(row)
}

async function touchStory(db: DrizzleDb, storyId: string, now: string) {
  await db
    .update(stories)
    .set({ updatedAt: now })
    .where(eq(stories.id, storyId))
}

async function nextPosition(db: DrizzleDb, storyId: string): Promise<number> {
  const row = await db
    .select({ max: sql<number | null>`MAX(${storyEntries.position})` })
    .from(storyEntries)
    .where(eq(storyEntries.storyId, storyId))
    .then((rows) => rows[0])
  const max = row?.max
  return max === null || max === undefined ? 0 : max + 1
}

/**
 * The one write path for an *appended* passage: position, story touch and
 * revalidate live here so a caller can never append a row that the sidebar's
 * updatedAt ordering or the manuscript's cache misses. (Two callers build rows
 * of their own instead of appending to a live story — the importer writes
 * position 0 inside its own transaction, and the seed script writes a whole
 * story at once.)
 *
 * `action` carries the player-turn columns and is null for everything else.
 * The pair travels together because actionKind and inputText are only ever
 * both set or both null — see the StoryEntry doc comment.
 */
async function appendEntry(
  storyId: string,
  text: string,
  source: EntrySource,
  action: { kind: ActionKind; inputText: string } | null = null
): Promise<ActionResult<{ entry: StoryEntry }>> {
  const trimmed = text.trim()
  if (trimmed === "")
    return { ok: false, error: "Nothing to add — write something first." }

  const db = await getDb()
  if (!(await storyExists(db, storyId)))
    return { ok: false, error: "Story not found." }

  const now = new Date().toISOString()
  const row = {
    id: crypto.randomUUID(),
    storyId,
    position: await nextPosition(db, storyId),
    source,
    text: trimmed,
    actionKind: action?.kind ?? null,
    inputText: action?.inputText ?? null,
    createdAt: now,
  }

  await db.insert(storyEntries).values(row)
  await touchStory(db, storyId, now)

  revalidatePath("/", "layout")
  return { ok: true, data: { entry: toStoryEntry(row) } }
}

/**
 * Appends the writer's turn: they type first person, the page reads second.
 *
 * The translation runs *here* rather than arriving pre-translated from the
 * client, because what the client sends is the one thing a user can forge and
 * the stored prose is what the model is conditioned on for the rest of the
 * story. The composer runs the same pure function purely for its optimistic
 * echo; this row is the authority, and if the two ever disagree the client's
 * copy is the one that gets replaced.
 *
 * Both blanks are rejected: an empty raw input is nothing to submit, and a raw
 * input that translates to nothing (whitespace, punctuation the transform
 * strips) would otherwise write an empty passage the writer can only find by
 * scrolling into it.
 */
export async function appendActionEntry(
  storyId: string,
  kind: ActionKind,
  rawText: string
): Promise<ActionResult<{ entry: StoryEntry }>> {
  const raw = rawText.trim()
  if (raw === "")
    return { ok: false, error: "Nothing to add — write something first." }

  const translated = translateAction(kind, raw)
  if (translated.trim() === "")
    return { ok: false, error: "Nothing to add — write something first." }

  return appendEntry(storyId, translated, "user", { kind, inputText: raw })
}

/** Appends a generated passage — called by the client after streaming completes. */
export async function appendGeneratedEntry(
  storyId: string,
  text: string
): Promise<ActionResult<{ entry: StoryEntry }>> {
  return appendEntry(storyId, text, "generated")
}

export async function updateEntryText(
  storyId: string,
  entryId: string,
  text: string
): Promise<ActionResult> {
  const trimmed = text.trim()
  if (trimmed === "") return { ok: false, error: "A passage can't be empty." }

  const db = await getDb()
  const now = new Date().toISOString()
  const updated = await db
    .update(storyEntries)
    .set({ text: trimmed })
    .where(and(eq(storyEntries.id, entryId), eq(storyEntries.storyId, storyId)))
    .returning({ id: storyEntries.id })

  if (updated.length === 0) return { ok: false, error: "Passage not found." }

  await touchStory(db, storyId, now)
  revalidatePath("/", "layout")
  return { ok: true, data: null }
}

export async function deleteEntry(
  storyId: string,
  entryId: string
): Promise<ActionResult> {
  const db = await getDb()
  const now = new Date().toISOString()
  const deleted = await db
    .delete(storyEntries)
    .where(and(eq(storyEntries.id, entryId), eq(storyEntries.storyId, storyId)))
    .returning({ id: storyEntries.id })

  if (deleted.length === 0) return { ok: false, error: "Passage not found." }

  await touchStory(db, storyId, now)
  revalidatePath("/", "layout")
  return { ok: true, data: null }
}

/** Removes the newest entry (any source). ok with removed:null when the story is empty. */
export async function undoLastEntry(
  storyId: string
): Promise<ActionResult<{ removed: StoryEntry | null }>> {
  const db = await getDb()
  if (!(await storyExists(db, storyId)))
    return { ok: false, error: "Story not found." }

  const last = await db
    .select()
    .from(storyEntries)
    .where(eq(storyEntries.storyId, storyId))
    .orderBy(desc(storyEntries.position))
    .limit(1)
    .then((rows) => rows[0])

  if (!last) return { ok: true, data: { removed: null } }

  const now = new Date().toISOString()
  await db.delete(storyEntries).where(eq(storyEntries.id, last.id))
  await touchStory(db, storyId, now)

  revalidatePath("/", "layout")
  return { ok: true, data: { removed: toStoryEntry(last) } }
}

/** Removes entryId AND every later entry (retry-from-here). */
export async function deleteEntriesFrom(
  storyId: string,
  entryId: string
): Promise<ActionResult<{ removedCount: number }>> {
  const db = await getDb()
  const anchor = await db
    .select({ position: storyEntries.position })
    .from(storyEntries)
    .where(and(eq(storyEntries.id, entryId), eq(storyEntries.storyId, storyId)))
    .limit(1)
    .then((rows) => rows[0])

  if (!anchor) return { ok: false, error: "Passage not found." }

  const now = new Date().toISOString()
  const removed = await db
    .delete(storyEntries)
    .where(
      and(
        eq(storyEntries.storyId, storyId),
        gte(storyEntries.position, anchor.position)
      )
    )
    .returning({ id: storyEntries.id })

  await touchStory(db, storyId, now)
  revalidatePath("/", "layout")
  return { ok: true, data: { removedCount: removed.length } }
}
