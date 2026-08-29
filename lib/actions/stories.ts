"use server"

import { and, asc, eq, isNull } from "drizzle-orm"

import { commitStoryDelete, commitStoryUpsert } from "@/lib/actions/commit"
import { getDb } from "@/lib/db/client"
import {
  getAppSettings,
  listStories,
  listStoryRecords,
  STORY_PAGE_SIZE,
  type StoryPage,
} from "@/lib/db/queries"
import {
  lorebookEntries,
  stories,
  storyEntries,
  type StoryRow,
} from "@/lib/db/schema"
import { storyVersionBump } from "@/lib/db/story-version"
import { discardStoryRun } from "@/lib/generation/live"
import { discardStoryDeriveRun } from "@/lib/images/derive-run"
import { discardStoryImageRun } from "@/lib/images/live"
import { DEFAULT_GENERATION_SETTINGS } from "@/lib/mock-data"
import {
  isValidEntityId,
  toStoryRecord,
  type StoryRecord,
} from "@/lib/store/records"
import { clampLoreBudget, isContextWindow } from "@/lib/types"
import type { ActionResult, GenerationSettings } from "@/lib/types"

/**
 * The client projection of a row an UPDATE/INSERT just returned. Every field
 * but one comes from RETURNING — that row and its version are one fact from one
 * statement. The word count is the exception: it is a SQL aggregate over the
 * manuscript, so it takes a second, story-scoped read.
 */
async function recordFor(row: StoryRow): Promise<StoryRecord> {
  const counted = await listStoryRecords({ storyId: row.id })
  return toStoryRecord(row, counted[0]?.row.wordCount ?? 0)
}

/** pg 23505, anywhere on the cause chain drizzle wraps driver errors in. */
function isUniqueViolation(error: unknown): boolean {
  let cursor: unknown = error
  for (
    let depth = 0;
    depth < 5 && cursor !== null && cursor !== undefined;
    depth++
  ) {
    if (
      typeof cursor === "object" &&
      (cursor as { code?: unknown }).code === "23505"
    ) {
      return true
    }
    cursor = (cursor as { cause?: unknown }).cause
  }
  return false
}

/**
 * One more window of the library for the sidebar's "Load more".
 *
 * An action rather than a route because the sidebar lives in the root layout:
 * it has no route of its own to re-render with a wider window, and a search
 * param would put the sidebar's scroll depth in the URL of whatever page the
 * writer happens to be on.
 */
export async function loadStoryPage(input: {
  offset: number
  query?: string
}): Promise<ActionResult<StoryPage>> {
  const page = await listStories({
    limit: STORY_PAGE_SIZE,
    offset: input.offset,
    query: input.query,
  })
  return { ok: true, data: page }
}

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
  /** Client-minted, so the caller can render the row before this returns. */
  id?: string
  origin?: string
}): Promise<ActionResult<{ id: string; record: StoryRecord }>> {
  if (input?.id !== undefined && !isValidEntityId(input.id)) {
    return { ok: false, error: "Invalid story id." }
  }

  const db = await getDb()
  const appSettings = await getAppSettings()
  const now = new Date().toISOString()
  const title = input?.title?.trim() || "Untitled Story"
  const id = input?.id ?? crypto.randomUUID()

  let inserted: StoryRow | undefined
  try {
    ;[inserted] = await db
      .insert(stories)
      .values({
        id,
        title,
        description: "",
        genre: "",
        memory: "",
        authorsNote: "",
        // null, not "": new stories track the built-in narrator prompt.
        systemPrompt: null,
        // The default profile, which supersedes the app's default model/thinking
        // pair — those columns are still on disk but nothing reads them now
        // except the one-time seed in getAppSettings.
        profileId: appSettings.defaultProfileId,
        modelId: DEFAULT_GENERATION_SETTINGS.modelId,
        thinking: DEFAULT_GENERATION_SETTINGS.thinking,
        // Auto: a new story has no reason to pin one provider of its model.
        providerTag: null,
        temperature: DEFAULT_GENERATION_SETTINGS.temperature,
        topP: DEFAULT_GENERATION_SETTINGS.topP,
        contextWindow: DEFAULT_GENERATION_SETTINGS.contextWindow,
        frequencyPenalty: DEFAULT_GENERATION_SETTINGS.frequencyPenalty,
        presencePenalty: DEFAULT_GENERATION_SETTINGS.presencePenalty,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  } catch (error) {
    // The client-minted id is the idempotency key: a create whose response was
    // lost is retried with the same id, so its own primary key collision means
    // the first attempt committed — and published — already. Confirm it.
    if (!isUniqueViolation(error) || input?.id === undefined) throw error
    const existing = await listStoryRecords({ storyId: id })
    const found = existing[0]
    if (!found) throw error
    return { ok: true, data: { id, record: found.row } }
  }

  if (!inserted) return { ok: false, error: "Story could not be created." }
  const record = await recordFor(inserted)

  // Null scope, not the new id: this is a library-level write — no device can
  // be on a story that didn't exist a moment ago, and scoping it to the id
  // would strand the event if change handling ever filters by story.
  commitStoryUpsert(record, input?.origin ?? null, null)
  return { ok: true, data: { id, record } }
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
    /** Whether new summary versions are written. See the schema's column note. */
    summarize?: boolean
  },
  opts?: { origin?: string }
): Promise<ActionResult<{ record: StoryRecord }>> {
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
  if (patch.summarize !== undefined) values.summarize = patch.summarize
  if (patch.systemPrompt !== undefined) {
    // Blank means "no override" — stored as NULL so the story keeps following
    // the built-in prompt as it changes, rather than freezing an empty string.
    const trimmed = patch.systemPrompt?.trim() ?? ""
    values.systemPrompt = trimmed === "" ? null : patch.systemPrompt
  }

  const db = await getDb()
  // One statement: the new version has to be minted inside the UPDATE, or two
  // writers landing in the same millisecond mint the same version for two
  // different row states. See lib/db/story-version.ts.
  const [updated] = await db
    .update(stories)
    .set({ ...values, updatedAt: storyVersionBump(new Date().toISOString()) })
    .where(eq(stories.id, id))
    .returning()

  if (!updated) return { ok: false, error: "Story not found." }

  const record = await recordFor(updated)
  commitStoryUpsert(record, opts?.origin ?? null)
  return { ok: true, data: { record } }
}

/**
 * Set (or clear) the story's atmosphere.
 *
 * Validated here rather than trusted from the client, because these two numbers
 * are interpolated straight into a stylesheet the browser will run — see
 * StoryTint. A hue outside 0..359 or a strength outside 0..1 is clamped rather
 * than rejected: they are a swatch and a slider, and there is no writer-visible
 * failure that "your colour was 400 degrees" would explain.
 */
export async function updateStoryTint(
  id: string,
  patch: {
    /** Degrees, or null to clear the tint back to the neutral palette. */
    hue: number | null
    /** 0..1. Ignored when hue is null. */
    strength?: number
    /**
     * Whether the atmosphere call may keep choosing after this. Left undefined
     * leaves the flag alone; the swatch row passes false, because a colour
     * chosen by hand is a decision and not a starting point.
     */
    auto?: boolean
  },
  opts?: { origin?: string }
): Promise<ActionResult<{ record: StoryRecord }>> {
  const hue =
    patch.hue === null || !Number.isFinite(patch.hue)
      ? null
      : ((Math.round(patch.hue) % 360) + 360) % 360
  const strength =
    patch.strength === undefined || !Number.isFinite(patch.strength)
      ? undefined
      : Math.min(1, Math.max(0, patch.strength))

  const db = await getDb()
  const [updated] = await db
    .update(stories)
    .set({
      tintHue: hue,
      ...(strength === undefined ? {} : { tintStrength: strength }),
      ...(patch.auto === undefined ? {} : { tintAuto: patch.auto }),
      updatedAt: storyVersionBump(new Date().toISOString()),
    })
    .where(eq(stories.id, id))
    .returning()

  if (!updated) return { ok: false, error: "Story not found." }

  const record = await recordFor(updated)
  commitStoryUpsert(record, opts?.origin ?? null)
  return { ok: true, data: { record } }
}

/**
 * Hand the tint back to the model, or take it away again.
 *
 * Its own action rather than a field on updateStoryTint's patch because turning
 * Auto back on deliberately writes NOTHING else: the story keeps whatever
 * colour it is wearing until the next post-turn check decides the scene has
 * moved. Clearing the hue here would flash the room grey in between, which is
 * not what "let it choose" should look like.
 */
export async function setStoryTintAuto(
  id: string,
  auto: boolean,
  opts?: { origin?: string }
): Promise<ActionResult<{ record: StoryRecord }>> {
  const db = await getDb()
  const [updated] = await db
    .update(stories)
    .set({
      tintAuto: auto,
      updatedAt: storyVersionBump(new Date().toISOString()),
    })
    .where(eq(stories.id, id))
    .returning()

  if (!updated) return { ok: false, error: "Story not found." }

  const record = await recordFor(updated)
  commitStoryUpsert(record, opts?.origin ?? null)
  return { ok: true, data: { record } }
}

/** Full copy (entries + lorebook + settings), title suffixed " (copy)", fresh ids/timestamps. */
export async function duplicateStory(
  id: string,
  opts?: { copyId?: string; origin?: string }
): Promise<ActionResult<{ id: string; record: StoryRecord }>> {
  if (opts?.copyId !== undefined && !isValidEntityId(opts.copyId)) {
    return { ok: false, error: "Invalid story id." }
  }

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
  const copyId = opts?.copyId ?? crypto.randomUUID()

  let copy: StoryRow | undefined
  try {
    ;[copy] = await db
      .insert(stories)
      .values({
        ...source,
        id: copyId,
        title: `${source.title} (copy)`,
        // No ops are copied, so the copy's cursor has to start where an
        // untouched story's does. Undo history is a record of what the writer
        // did to *this* manuscript; inheriting the original's would offer to
        // reverse edits whose rows were never copied, and `...source` would
        // otherwise carry a non-zero cursor pointing at ops that do not exist
        // here.
        undoCursor: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  } catch (error) {
    // Same idempotency key as createStory: our own copyId colliding means the
    // first attempt committed and published.
    if (!isUniqueViolation(error) || opts?.copyId === undefined) throw error
    const existing = await listStoryRecords({ storyId: copyId })
    const found = existing[0]
    if (!found) throw error
    return { ok: true, data: { id: copyId, record: found.row } }
  }

  if (!copy) return { ok: false, error: "Story could not be copied." }

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
  const record = await recordFor(copy)
  commitStoryUpsert(record, opts?.origin ?? null, null)
  return { ok: true, data: { id: copyId, record } }
}

export async function deleteStory(
  id: string,
  opts?: { origin?: string }
): Promise<ActionResult> {
  // The story's live run goes with it — left running, the loop keeps
  // streaming and billing against a manuscript that no longer exists, and its
  // settle ends "error" over a persist the delete doomed. Discard aborts the
  // run and ends it "aborted" with nothing persisted.
  discardStoryRun(id)
  // ...and its draw, for the same reason: nothing may persist into a
  // manuscript that is going away.
  discardStoryImageRun(id)
  // ...and its develop: the loop ends by writing the story's draft row, and a
  // row whose story is gone is an FK violation logged from a detached task.
  discardStoryDeriveRun(id)
  const db = await getDb()
  // Child entries and lorebook entries go with it: Postgres enforces the
  // ON DELETE CASCADE declared on both story_id columns, so no explicit child
  // delete is needed.
  const deleted = await db
    .delete(stories)
    .where(eq(stories.id, id))
    .returning({ id: stories.id })

  // Already gone: a delete whose response was lost is retried against a row
  // that is no longer there, and the first attempt published its own removal.
  if (deleted.length === 0) return { ok: true, data: null }

  // The event's scope is null: the library list changed and the deleted story's
  // viewers must hear it too — global reaches both under any future filter.
  commitStoryDelete(id, new Date().toISOString(), opts?.origin ?? null)
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
  // A plain boolean with no closed set to guard and no clamp to apply. What it
  // cannot do is lower the app-wide floor: this column is the story's own ask,
  // and lib/generation/resolve.ts ORs the policy on top of whatever it says.
  if (patch.zdr !== undefined) values.zdr = patch.zdr
  if (patch.temperature !== undefined) values.temperature = patch.temperature
  if (patch.topP !== undefined) values.topP = patch.topP
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
  // Clamped rather than rejected: unlike the context window this is a plain
  // range with a step, so an out-of-range number has an obvious right answer
  // and refusing the write would only strand the slider.
  if (patch.loreBudget !== undefined) {
    values.loreBudget = clampLoreBudget(patch.loreBudget)
  }
  if (patch.frequencyPenalty !== undefined)
    values.frequencyPenalty = patch.frequencyPenalty
  if (patch.presencePenalty !== undefined)
    values.presencePenalty = patch.presencePenalty

  const db = await getDb()
  const [updated] = await db
    .update(stories)
    .set({ ...values, updatedAt: storyVersionBump(new Date().toISOString()) })
    .where(eq(stories.id, id))
    .returning()

  if (!updated) return { ok: false, error: "Story not found." }

  commitStoryUpsert(await recordFor(updated), null)
  return { ok: true, data: null }
}

/**
 * Which image model this story draws with.
 *
 * Its own action rather than a field on updateGenerationSettings, because it is
 * not a generation setting: those columns are the ones a model profile can
 * override, and this one is deliberately outside that system — there are few
 * enough image models that bundling them into named profiles would be ceremony.
 * Keeping it separate is what lets a story that FOLLOWS a profile still pick
 * its own image model.
 *
 * Unvalidated against the catalog, for the same reason providerTag is: the
 * image catalog is a live remote list, and paying for a fetch on every change
 * to reject an id that the next request would reject anyway is a poor trade.
 */
export async function setStoryImageModel(
  id: string,
  /** A concrete choice, or null to follow the app's default image model. */
  imageModelId: string | null
): Promise<ActionResult> {
  const db = await getDb()
  const [updated] = await db
    .update(stories)
    .set({
      imageModelId,
      updatedAt: storyVersionBump(new Date().toISOString()),
    })
    .where(eq(stories.id, id))
    .returning()

  if (!updated) return { ok: false, error: "Story not found." }

  commitStoryUpsert(await recordFor(updated), null)
  return { ok: true, data: null }
}
