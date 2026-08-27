"use server"

import { desc, eq } from "drizzle-orm"

import { commitChange } from "@/lib/actions/commit"
import { getDb } from "@/lib/db/client"
import {
  toGenerationSettings,
  toModelProfile,
  toProfileSettings,
} from "@/lib/db/mappers"
import { getAppSettings, getGenerationBaseline } from "@/lib/db/queries"
import { appSettings, modelProfiles, stories } from "@/lib/db/schema"
import {
  customColumnsFromSettings,
  resolveGenerationSettings,
  resolveProfileSettings,
} from "@/lib/generation/resolve"
import {
  clampLoreBudget,
  isContextWindow,
  REASONING_EFFORTS,
  type ActionResult,
  type ProfileSettings,
} from "@/lib/types"

const NOT_FOUND = "Profile not found."

/**
 * Server-side validation of the fields with a closed value set, mirroring
 * updateAppSettings and updateGenerationSettings: a profile feeds generation
 * for every story that follows it, so an unknown thinking level or an
 * off-ladder context window would 400 (or render blank) once per follower
 * rather than once here.
 *
 * providerTag is deliberately unchecked, exactly as on a story: the endpoint
 * list is a live remote catalog and a stale tag is dropped at send time by
 * providerParam(), not rejected on the way in.
 *
 * A null contextWindow passes: it is not an off-ladder window but the absence
 * of one, and the ladder is enforced on the global default instead.
 */
function validateSettings(patch: Partial<ProfileSettings>): string | null {
  if (patch.modelId !== undefined && patch.modelId.trim() === "") {
    return "Pick a model."
  }
  if (
    patch.thinking !== undefined &&
    patch.thinking !== "off" &&
    !REASONING_EFFORTS.includes(patch.thinking)
  ) {
    return "Unknown thinking level."
  }
  if (
    patch.contextWindow !== undefined &&
    patch.contextWindow !== null &&
    !isContextWindow(patch.contextWindow)
  ) {
    return "Unsupported context window."
  }
  return null
}

/** Appended to the end of the writer's order; they reorder by hand from there. */
async function nextSortOrder(): Promise<number> {
  const db = await getDb()
  const last = await db
    .select({ sortOrder: modelProfiles.sortOrder })
    .from(modelProfiles)
    .orderBy(desc(modelProfiles.sortOrder))
    .limit(1)
    .then((rows) => rows[0])
  return last ? last.sortOrder + 1 : 0
}

/** Shared by createProfile and saveStoryAsProfile — same row, two entry points. */
async function insertProfile(
  name: string,
  settings: ProfileSettings
): Promise<ActionResult<{ id: string }>> {
  const trimmed = name.trim()
  if (trimmed === "") return { ok: false, error: "Name the profile." }
  const invalid = validateSettings(settings)
  if (invalid) return { ok: false, error: invalid }

  const db = await getDb()
  const id = crypto.randomUUID()
  await db.insert(modelProfiles).values({
    ...settings,
    id,
    name: trimmed,
    sortOrder: await nextSortOrder(),
  })
  return { ok: true, data: { id } }
}

export async function createProfile(input: {
  name: string
  settings: ProfileSettings
}): Promise<ActionResult<{ id: string }>> {
  const created = await insertProfile(input.name, input.settings)
  if (!created.ok) return created

  // Null, not a story id: profiles are global, so every device has to hear it —
  // including the ones sitting on a story that now has a new profile to offer.
  commitChange(null)
  return created
}

export async function updateProfile(
  id: string,
  patch: { name?: string; settings?: Partial<ProfileSettings> }
): Promise<ActionResult> {
  const values: Partial<typeof modelProfiles.$inferInsert> = {}
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim()
    if (trimmed === "") return { ok: false, error: "Name the profile." }
    values.name = trimmed
  }
  const settings = patch.settings ?? {}
  const invalid = validateSettings(settings)
  if (invalid) return { ok: false, error: invalid }

  if (settings.modelId !== undefined) values.modelId = settings.modelId
  if (settings.thinking !== undefined) values.thinking = settings.thinking
  // null is Auto, a real value, so only `undefined` means "not patched".
  if (settings.providerTag !== undefined)
    values.providerTag = settings.providerTag
  if (settings.zdr !== undefined) values.zdr = settings.zdr
  // Same rule one field wider on the sliders: null is "inherit the default",
  // a state the writer chose, so it is written; only `undefined` is skipped.
  if (settings.temperature !== undefined)
    values.temperature = settings.temperature
  if (settings.topP !== undefined) values.topP = settings.topP
  if (settings.contextWindow !== undefined)
    values.contextWindow = settings.contextWindow
  // Null is "inherit the global default", so only a real number is clamped.
  if (settings.loreBudget !== undefined) {
    values.loreBudget =
      settings.loreBudget === null ? null : clampLoreBudget(settings.loreBudget)
  }
  if (settings.frequencyPenalty !== undefined)
    values.frequencyPenalty = settings.frequencyPenalty
  if (settings.presencePenalty !== undefined)
    values.presencePenalty = settings.presencePenalty

  if (Object.keys(values).length === 0) return { ok: true, data: null }

  const db = await getDb()
  const updated = await db
    .update(modelProfiles)
    .set(values)
    .where(eq(modelProfiles.id, id))
    .returning({ id: modelProfiles.id })

  if (updated.length === 0) return { ok: false, error: NOT_FOUND }

  // No fan-out write to the followers: they read through the profile, so this
  // one UPDATE is the edit reaching all of them.
  commitChange(null)
  return { ok: true, data: null }
}

/**
 * Persists a hand-ordering of the whole list, not a single move: the client
 * already holds the order the writer just dragged into place, and writing it
 * wholesale means two devices reordering at once land on one list or the
 * other — never an interleaving with duplicate positions.
 *
 * A list that no longer matches the server's ids is refused rather than
 * partially applied: it was dragged on a stale view, and a profile created on
 * another device since then has no position in it.
 */
export async function reorderProfiles(
  orderedIds: string[]
): Promise<ActionResult> {
  const db = await getDb()
  const existing = await db
    .select({ id: modelProfiles.id })
    .from(modelProfiles)
    .then((rows) => new Set(rows.map((row) => row.id)))

  const stale =
    orderedIds.length !== existing.size ||
    new Set(orderedIds).size !== orderedIds.length ||
    orderedIds.some((id) => !existing.has(id))
  if (stale) {
    return { ok: false, error: "The profile list changed. Try again." }
  }

  await db.transaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(modelProfiles)
        .set({ sortOrder: index })
        .where(eq(modelProfiles.id, id))
    }
  })

  commitChange(null)
  return { ok: true, data: null }
}

export async function setDefaultProfile(id: string): Promise<ActionResult> {
  const db = await getDb()
  const profile = await db
    .select({ id: modelProfiles.id })
    .from(modelProfiles)
    .where(eq(modelProfiles.id, id))
    .limit(1)
    .then((rows) => rows[0])
  if (!profile) return { ok: false, error: NOT_FOUND }

  // Ensures the single settings row exists before patching it.
  await getAppSettings()
  await db
    .update(appSettings)
    .set({ defaultProfileId: id })
    .where(eq(appSettings.id, 1))

  commitChange(null)
  return { ok: true, data: null }
}

/**
 * Deletes a profile and flips its followers to Custom, seeded with the settings
 * they were reading through it — the one place profile code writes a story's
 * settings columns, and only because the row those columns deferred to is about
 * to stop existing. Without it a follower would fall back to whatever custom
 * settings it last had, silently changing model mid-story.
 *
 * The default is refused rather than reassigned: which profile new stories
 * start from is the writer's choice, and picking a survivor for them is a guess
 * that shows up later as a story on the wrong model.
 */
export async function deleteProfile(id: string): Promise<ActionResult> {
  const settings = await getAppSettings()
  if (settings.defaultProfileId === id) {
    return { ok: false, error: "Make another profile the default first." }
  }

  // Read outside the transaction: the followers are frozen at the values they
  // were generating under, and an inherited slider has to become the number the
  // default currently holds — after the profile is gone there is nothing left
  // to inherit through.
  const baseline = await getGenerationBaseline()

  const db = await getDb()
  const deleted = await db.transaction(async (tx) => {
    const profile = await tx
      .select()
      .from(modelProfiles)
      .where(eq(modelProfiles.id, id))
      .limit(1)
      .then((rows) => rows[0])
    if (!profile) return false

    // Followers first: a story left pointing at a deleted profile between the
    // two statements would read Custom off columns it has not been given yet.
    await tx
      .update(stories)
      .set({
        ...customColumnsFromSettings(
          resolveProfileSettings(toProfileSettings(profile), baseline)
        ),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(stories.profileId, id))
    await tx.delete(modelProfiles).where(eq(modelProfiles.id, id))
    return true
  })

  if (!deleted) return { ok: false, error: NOT_FOUND }

  commitChange(null)
  return { ok: true, data: null }
}

/**
 * Points a story at a profile, or at null for Custom.
 *
 * Writes profile_id and nothing else: the story's settings columns are its
 * custom memory, so switching to a profile and back lands the writer exactly
 * where they left off.
 */
export async function setStoryProfile(
  storyId: string,
  profileId: string | null
): Promise<ActionResult> {
  const db = await getDb()
  if (profileId !== null) {
    const profile = await db
      .select({ id: modelProfiles.id })
      .from(modelProfiles)
      .where(eq(modelProfiles.id, profileId))
      .limit(1)
      .then((rows) => rows[0])
    if (!profile) return { ok: false, error: NOT_FOUND }
  }

  const updated = await db
    .update(stories)
    .set({ profileId, updatedAt: new Date().toISOString() })
    .where(eq(stories.id, storyId))
    .returning({ id: stories.id })

  if (updated.length === 0) return { ok: false, error: "Story not found." }

  // Null even though one story moved: the switch can only have been made from a
  // profile list every device shows, and a device on the settings page needs the
  // follower count it prints to move too.
  commitChange(null)
  return { ok: true, data: null }
}

/**
 * Promotes a story's settings into a named profile and points the story at it —
 * the end of a successful experiment. The story's columns keep the same values
 * they had, so a later return to Custom is still lossless.
 *
 * The new profile is seeded with the story's EFFECTIVE settings, not its raw
 * columns: the UI only offers this in Custom mode, where the two are the same,
 * but a story that is already following a profile would otherwise get a profile
 * copied from custom settings nobody has generated under in a while.
 */
export async function saveStoryAsProfile(
  storyId: string,
  name: string
): Promise<ActionResult<{ id: string }>> {
  const db = await getDb()
  const story = await db
    .select()
    .from(stories)
    .where(eq(stories.id, storyId))
    .limit(1)
    .then((rows) => rows[0])
  if (!story) return { ok: false, error: "Story not found." }

  const followed =
    story.profileId === null
      ? undefined
      : await db
          .select()
          .from(modelProfiles)
          .where(eq(modelProfiles.id, story.profileId))
          .limit(1)
          .then((rows) => rows[0])

  // Every slider written as an explicit override, not as an inherit: the writer
  // is promoting settings they tuned on this story, and a profile that quietly
  // tracked the global defaults instead would not be the thing they saved.
  const created = await insertProfile(
    name,
    resolveGenerationSettings(
      toGenerationSettings(story),
      followed ? toModelProfile(followed) : null,
      await getGenerationBaseline()
    )
  )
  if (!created.ok) return created

  await db
    .update(stories)
    .set({ profileId: created.data.id, updatedAt: new Date().toISOString() })
    .where(eq(stories.id, storyId))

  commitChange(null)
  return created
}
