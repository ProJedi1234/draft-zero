"use server"

import { and, asc, eq, isNull } from "drizzle-orm"

import { commitChange } from "@/lib/actions/commit"
import { getDb } from "@/lib/db/client"
import { getAppSettings } from "@/lib/db/queries"
import { lorebookEntries, stories, storyEntries } from "@/lib/db/schema"
import { discardStoryRun } from "@/lib/generation/live"
import { DEFAULT_GENERATION_SETTINGS } from "@/lib/mock-data"
import { isContextWindow } from "@/lib/types"
import type { ActionResult, GenerationSettings } from "@/lib/types"

/**
 * Creates a story with title "Untitled Story" (or given), empty text fields,
 * following the default profile.
 *
 * The inline settings columns are the story's CUSTOM memory, not its effective
 * settings, so they start from DEFAULT_GENERATION_SETTINGS rather than from the
 * profile: a copy of the profile here would be a snapshot that later edits to
 * the profile could not move, and profile code does not write these columns.
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
    // null, not "": new stories track the built-in narrator prompt.
    systemPrompt: null,
    // The default profile, which supersedes the app's default model/thinking
    // pair — those columns are still on disk but nothing reads them now except
    // the one-time seed in getAppSettings.
    profileId: appSettings.defaultProfileId,
    modelId: DEFAULT_GENERATION_SETTINGS.modelId,
    thinking: DEFAULT_GENERATION_SETTINGS.thinking,
    // Auto: a new story has no reason to pin one provider of its default model.
    providerTag: null,
    temperature: DEFAULT_GENERATION_SETTINGS.temperature,
    topP: DEFAULT_GENERATION_SETTINGS.topP,
    maxTokens: DEFAULT_GENERATION_SETTINGS.maxTokens,
    contextWindow: DEFAULT_GENERATION_SETTINGS.contextWindow,
    frequencyPenalty: DEFAULT_GENERATION_SETTINGS.frequencyPenalty,
    presencePenalty: DEFAULT_GENERATION_SETTINGS.presencePenalty,
    createdAt: now,
    updatedAt: now,
  })

  // Null, not the new id: this is a library-level write — no device can be on
  // a story that didn't exist a moment ago, and scoping it to the id would
  // strand the event if change handling ever filters by story.
  commitChange(null)
  return { ok: true, data: { id } }
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
    /** "" clears the override back to the built-in prompt. */
    systemPrompt?: string | null
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
  if (patch.systemPrompt !== undefined) {
    // Blank means "no override" — stored as NULL so the story keeps following
    // the built-in prompt as it changes, rather than freezing an empty string.
    const trimmed = patch.systemPrompt?.trim() ?? ""
    values.systemPrompt = trimmed === "" ? null : patch.systemPrompt
  }

  const db = await getDb()
  const updated = await db
    .update(stories)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(stories.id, id))
    .returning({ id: stories.id })

  if (updated.length === 0) return { ok: false, error: "Story not found." }

  commitChange(id)
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

  // Only the manuscript as it currently reads gets copied: deleted passages and
  // the inactive alternative takes belong to the original's history, and the
  // copy is deliberately given none (see below). Copying them would be worse
  // than useless — with no ops to explain them they would have to land as
  // ordinary active passages, so every retried block would appear twice.
  const [entries, lore] = await Promise.all([
    db
      .select()
      .from(storyEntries)
      .where(
        and(
          eq(storyEntries.storyId, id),
          isNull(storyEntries.deletedAt),
          eq(storyEntries.isActive, true)
        )
      )
      .orderBy(asc(storyEntries.position)),
    db.select().from(lorebookEntries).where(eq(lorebookEntries.storyId, id)),
  ])

  const now = new Date().toISOString()
  const copyId = crypto.randomUUID()

  await db.insert(stories).values({
    ...source,
    id: copyId,
    title: `${source.title} (copy)`,
    // No ops are copied, so the copy's cursor has to start where an untouched
    // story's does. Undo history is a record of what the writer did to *this*
    // manuscript; inheriting the original's would offer to reverse edits whose
    // rows were never copied, and `...source` would otherwise carry a non-zero
    // cursor pointing at ops that do not exist here.
    undoCursor: 0,
    createdAt: now,
    updatedAt: now,
  })

  // actionKind/inputText travel with the copy: a player turn in the original is
  // still a player turn here, and dropping the pair would silently demote every
  // Say and Do in the copy to un-re-editable prose.
  if (entries.length > 0) {
    await db.insert(storyEntries).values(
      entries.map((entry, index) => {
        // Each copied passage opens a fresh one-take slot named after itself.
        // The original's variant groups are not carried over: their other takes
        // were left behind above, so a shared group id would describe a slot
        // that no longer has anything else in it.
        const entryId = crypto.randomUUID()
        return {
          id: entryId,
          storyId: copyId,
          position: index,
          variantGroupId: entryId,
          variantIndex: 0,
          isActive: true,
          source: entry.source,
          text: entry.text,
          actionKind: entry.actionKind,
          inputText: entry.inputText,
          createdAt: now,
        }
      })
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

  // Library-level for the same reason as createStory: the copy has no viewers.
  commitChange(null)
  return { ok: true, data: { id: copyId } }
}

export async function deleteStory(id: string): Promise<ActionResult> {
  // The story's live run goes with it — left running, the loop keeps
  // streaming and billing against a manuscript that no longer exists, and its
  // settle ends "error" over a persist the delete doomed. Discard aborts the
  // run and ends it "aborted" with nothing persisted.
  discardStoryRun(id)
  const db = await getDb()
  // Child entries and lorebook entries go with it: Postgres enforces the
  // ON DELETE CASCADE declared on both story_id columns, so no explicit child
  // delete is needed.
  const deleted = await db
    .delete(stories)
    .where(eq(stories.id, id))
    .returning({ id: stories.id })

  if (deleted.length === 0) return { ok: false, error: "Story not found." }

  // Null: the library list changed and the deleted story's viewers must hear
  // it too — global reaches both under any future story filter.
  commitChange(null)
  return { ok: true, data: null }
}

export async function updateGenerationSettings(
  id: string,
  patch: Partial<GenerationSettings>
): Promise<ActionResult> {
  const values: Partial<typeof stories.$inferInsert> = {}
  if (patch.modelId !== undefined) values.modelId = patch.modelId
  if (patch.thinking !== undefined) values.thinking = patch.thinking
  // null is a real value here (Auto), so only `undefined` means "not patched".
  // Unvalidated on purpose: the endpoint list is a live remote catalog, and a
  // tag that no longer serves this model is dropped at send time by
  // providerParam() rather than rejected on the way in — see openrouter.ts.
  if (patch.providerTag !== undefined) values.providerTag = patch.providerTag
  if (patch.temperature !== undefined) values.temperature = patch.temperature
  if (patch.topP !== undefined) values.topP = patch.topP
  if (patch.maxTokens !== undefined) values.maxTokens = patch.maxTokens
  if (patch.contextWindow !== undefined) {
    // The only settings field with a closed value set, so it is the only one
    // worth guarding: a stop that is not on the ladder would render as a blank
    // slider readout. The model-window clamp deliberately stays in the
    // inspector — lib/generation/models.ts is a network-backed catalog, and
    // paying for a catalog fetch on every slider commit to re-derive a limit
    // the client already applied would be a poor trade.
    if (!isContextWindow(patch.contextWindow)) {
      return { ok: false, error: "Unsupported context window." }
    }
    values.contextWindow = patch.contextWindow
  }
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

  commitChange(id)
  return { ok: true, data: null }
}
