// lib/services/entries.ts — Passage writes and reads, callable from a server
// action, a route handler or an MCP tool alike.
//
// The append/persist cores live in lib/db/entry-writes.ts: the generation run
// loop persists passages from a detached task with no request scope, where
// revalidatePath throws. The services here wrap those cores with the two
// refreshes a request-scoped write owes — commitChange, after the commit and
// never inside it, because the cache must not be promised rows a rollback
// took back.
import "server-only"

import { and, eq, gt, isNull } from "drizzle-orm"

import { getDb } from "@/lib/db/client"
import { appendEntryCore, touchStoryRow } from "@/lib/db/entry-writes"
import { recordOp } from "@/lib/db/journal"
import {
  getStoryFull,
  listLorebookEntries,
  listOlderEntries,
  type OlderEntriesPage,
} from "@/lib/db/queries"
import { storyEntries } from "@/lib/db/schema"
import { composeContext } from "@/lib/generation/context"
import { listModelEndpoints } from "@/lib/generation/endpoints"
import { refuseDuringRun } from "@/lib/generation/live"
import { listModels } from "@/lib/generation/models"
import type { EntryProse } from "@/lib/history/ops"
import { commitChange } from "@/lib/services/commit"
import type { Service } from "@/lib/services/context"
import {
  appendActionEntryInput,
  appendEntryOutsideRunInput,
  deleteEntryInput,
  loadEntryContextInput,
  loadOlderEntriesInput,
  rewindToEntryInput,
  updateActionEntryInput,
  updateEntryTextInput,
  type AppendActionEntryInput,
  type AppendEntryOutsideRunInput,
  type DeleteEntryInput,
  type EntryContext,
  type LoadEntryContextInput,
  type LoadOlderEntriesInput,
  type RewindToEntryInput,
  type UpdateActionEntryInput,
  type UpdateEntryTextInput,
} from "@/lib/services/entries.schema"
import {
  fail,
  ok,
  parseInput,
  type ServiceFailure,
  type ServiceResult,
} from "@/lib/services/result"
import { translateAction } from "@/lib/story/action-voice"
import {
  clampContextWindow,
  endpointForTag,
  type ActionKind,
  type ActionResult,
  type StoryEntry,
} from "@/lib/types"

/**
 * The old actions refused a live run before checking anything else, so the
 * guard runs ahead of the parse to keep that order. A Map lookup on an
 * unparsed string is safe.
 */
function refuseRun(storyId: unknown): ServiceFailure | null {
  if (typeof storyId !== "string") return null
  const running = refuseDuringRun(storyId)
  return running ? fail("conflict", running.error) : null
}

/** appendEntryCore answers with a bare ActionResult; give its two refusals codes. */
function coded<T>(result: ActionResult<T>): ServiceResult<T> {
  if (result.ok) return result
  return fail(
    result.error === "Story not found." ? "not_found" : "invalid",
    result.error
  )
}

/** The prose columns an `edit` op has to carry, as they read right now. */
function proseOf(row: {
  text: string
  actionKind: ActionKind | null
  inputText: string | null
}): EntryProse {
  return {
    text: row.text,
    actionKind: row.actionKind,
    inputText: row.inputText,
  }
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
 *
 * Deliberately does NOT commit, and its caller (startGeneration) owns that
 * instead. This insert sits in the critical path between the writer pressing
 * Send and the first token: revalidating here makes the server re-render the
 * whole layout and ship it back before generation can even start, for a row
 * the canvas is already showing a byte-identical echo of. useGeneration
 * refreshes the tree exactly once, when the turn settles — and on every failure
 * path too, so this row can never stay invisible.
 */
export const appendActionEntry: Service<
  AppendActionEntryInput,
  { entry: StoryEntry }
> = async (raw) => {
  const parsed = parseInput(appendActionEntryInput, raw)
  if (!parsed.ok) return parsed
  const { storyId, kind, rawText, turnId } = parsed.data

  const translated = translateAction(kind, rawText)
  if (translated.trim() === "")
    return fail("invalid", "Nothing to add — write something first.")

  return coded(
    await appendEntryCore(storyId, translated, "user", {
      action: { kind, inputText: rawText },
      turnId,
    })
  )
}

/**
 * Appends on behalf of a caller that does NOT own the story's run — today,
 * the MCP write tool. Narration is prose as-is with no actionKind (the UI has
 * no direct caller for that: every composer send is a Say or Do, or a
 * generation settling); do/say goes through appendActionEntry's translation
 * exactly as the composer's does.
 *
 * The guard lives here rather than in appendActionEntry because
 * appendActionEntry's other caller is startGeneration, which reserves the
 * story's run slot BEFORE it appends — the run owner would be refused by its
 * own check. Every other mutator below carries the guard directly; this is
 * the entry point that lets an append carry it too, instead of racing the run
 * loop for a position and losing a billed passage to the unique index.
 *
 * Deliberately does NOT commit — same reasoning as appendActionEntry above:
 * the caller is in the best position to decide when the request-scoped
 * revalidate and the sync-bus touch should land.
 */
export const appendEntryOutsideRun: Service<
  AppendEntryOutsideRunInput,
  { entry: StoryEntry }
> = async (raw, ctx) => {
  const running = refuseRun(raw.storyId)
  if (running) return running
  const parsed = parseInput(appendEntryOutsideRunInput, raw)
  if (!parsed.ok) return parsed
  const { storyId, mode, text } = parsed.data

  return mode === "narration"
    ? coded(await appendEntryCore(storyId, text, "user", {}))
    : appendActionEntry({ storyId, kind: mode, rawText: text }, ctx)
}

/**
 * Re-edits a player turn: the writer edits their own first-person input again,
 * and both columns are rewritten from it so the stored prose stays exactly
 * `translateAction(actionKind, inputText)`. Editing the translated text
 * directly (updateEntryText) would break that pair, leaving an inputText that
 * no longer explains the passage sitting beside it.
 *
 * The kind comes from the caller: the editor carries the same Say/Do switcher
 * the composer does, so an edit can re-voice the turn as well as reword it, and
 * the row's stored kind is only the value that switcher opened on. A row
 * without one is not a player turn at all — a generated passage, or a user
 * passage from before this feature — and there is nothing to re-translate, so
 * those go through updateEntryText.
 */
export const updateActionEntry: Service<UpdateActionEntryInput, null> = async (
  raw
) => {
  // Same threat model as deleteEntry: only a device that isn't mirroring the
  // run has this control lit, and its mid-run edit records an op the run's own
  // recordOp then can't fold the turn into.
  const running = refuseRun(raw.storyId)
  if (running) return running
  // The kind is checked by the schema rather than trusted from the client: it
  // decides the translation, and an unknown one would write prose
  // translateAction never voiced beside a column nothing else can read.
  const parsed = parseInput(updateActionEntryInput, raw)
  if (!parsed.ok) return parsed
  const { storyId, entryId, kind, rawText } = parsed.data

  const db = await getDb()
  const now = new Date().toISOString()

  const result = await db.transaction(async (tx): Promise<ServiceResult> => {
    // Inside the transaction, and the whole prose: it is the `before` undo has
    // to put back, old kind included, so a re-voiced turn undoes to the kind it
    // was. Reading it outside would let another tab's edit land in between and
    // be swallowed.
    const existing = await tx
      .select({
        text: storyEntries.text,
        actionKind: storyEntries.actionKind,
        inputText: storyEntries.inputText,
      })
      .from(storyEntries)
      .where(
        and(eq(storyEntries.id, entryId), eq(storyEntries.storyId, storyId))
      )
      .limit(1)
      .then((rows) => rows[0])

    if (!existing) return fail("not_found", "Passage not found.")
    if (existing.actionKind === null)
      return fail("invalid", "This passage isn't a Say or Do.")

    const translated = translateAction(kind, rawText)
    if (translated.trim() === "")
      return fail("invalid", "A passage can't be empty.")

    // The SELECT above read the prose, not a lock: the row can be soft-deleted
    // between the two statements (another tab's Delete), so the update has to
    // prove it landed the same way every other mutator here does.
    const updated = await tx
      .update(storyEntries)
      .set({ text: translated, actionKind: kind, inputText: rawText })
      .where(
        and(eq(storyEntries.id, entryId), eq(storyEntries.storyId, storyId))
      )
      .returning({ id: storyEntries.id })

    if (updated.length === 0) return fail("not_found", "Passage not found.")

    await recordOp(tx, storyId, {
      kind: "edit",
      entryId,
      before: proseOf(existing),
      after: { text: translated, actionKind: kind, inputText: rawText },
    })
    await touchStoryRow(tx, storyId, now)

    return ok(null)
  })

  if (result.ok) commitChange(storyId)
  return result
}

/**
 * Edits a passage's prose directly. Correct for generated passages and for
 * user passages predating Say/Do; player turns use updateActionEntry so the
 * translation and its raw input cannot drift apart.
 *
 * Writing prose here also clears actionKind/inputText, which is what the
 * editor's "Edit prose instead" hatch relies on: the moment a writer hand-fixes
 * the rendered sentence, the row stops being a translation of anything and
 * becomes ordinary prose. Leaving the pair behind would strand an inputText
 * that no longer explains the passage — and reopening the editor would seed
 * from it and re-translate the hand-fix away on the next save. Unconditional is
 * safe: both columns are already null on generated and legacy rows.
 *
 * The `before` recorded for undo carries all three columns for that reason:
 * undoing a hand-fix has to give the writer their Say back.
 */
export const updateEntryText: Service<UpdateEntryTextInput, null> = async (
  raw
) => {
  // See updateActionEntry — an edit landing mid-run on a take being retried
  // rewrites prose the run is about to deactivate anyway.
  const running = refuseRun(raw.storyId)
  if (running) return running
  const parsed = parseInput(updateEntryTextInput, raw)
  if (!parsed.ok) return parsed
  const { storyId, entryId, text: trimmed } = parsed.data

  const db = await getDb()
  const now = new Date().toISOString()

  const result = await db.transaction(async (tx): Promise<ServiceResult> => {
    const existing = await tx
      .select({
        text: storyEntries.text,
        actionKind: storyEntries.actionKind,
        inputText: storyEntries.inputText,
      })
      .from(storyEntries)
      .where(
        and(eq(storyEntries.id, entryId), eq(storyEntries.storyId, storyId))
      )
      .limit(1)
      .then((rows) => rows[0])

    if (!existing) return fail("not_found", "Passage not found.")

    const updated = await tx
      .update(storyEntries)
      .set({ text: trimmed, actionKind: null, inputText: null })
      .where(
        and(eq(storyEntries.id, entryId), eq(storyEntries.storyId, storyId))
      )
      .returning({ id: storyEntries.id })

    if (updated.length === 0) return fail("not_found", "Passage not found.")

    await recordOp(tx, storyId, {
      kind: "edit",
      entryId,
      before: proseOf(existing),
      after: { text: trimmed, actionKind: null, inputText: null },
    })
    await touchStoryRow(tx, storyId, now)

    return ok(null)
  })

  if (result.ok) commitChange(storyId)
  return result
}

/**
 * Removes a passage — a soft delete, never a DELETE. The row keeps its
 * `position`, so undo is a single UPDATE back to NULL and nothing is
 * renumbered.
 *
 * Already-deleted rows are excluded rather than treated as a success: a second
 * Delete would otherwise record a second op, and undoing it would restore a
 * passage the writer deleted twice and expected to stay gone.
 */
export const deleteEntry: Service<DeleteEntryInput, null> = async (raw) => {
  // Same guard as the history walkers (see lib/actions/history.ts): a delete
  // from a device that isn't mirroring the run can soft-delete the take the
  // run is about to persist beside, and the billed passage is refused.
  const running = refuseRun(raw.storyId)
  if (running) return running
  const parsed = parseInput(deleteEntryInput, raw)
  if (!parsed.ok) return parsed
  const { storyId, entryId } = parsed.data

  const db = await getDb()
  const now = new Date().toISOString()

  const result = await db.transaction(async (tx): Promise<ServiceResult> => {
    const deleted = await tx
      .update(storyEntries)
      .set({ deletedAt: now })
      .where(
        and(
          eq(storyEntries.id, entryId),
          eq(storyEntries.storyId, storyId),
          isNull(storyEntries.deletedAt)
        )
      )
      .returning({ id: storyEntries.id })

    if (deleted.length === 0) return fail("not_found", "Passage not found.")

    await recordOp(tx, storyId, { kind: "delete", entryId })
    await touchStoryRow(tx, storyId, now)

    return ok(null)
  })

  if (result.ok) commitChange(storyId)
  return result
}

/**
 * Rewinds the manuscript to one passage: every live passage AFTER it leaves the
 * story, the anchor itself stays, and the whole cut is one op — so one ⌘Z puts
 * the tail back and ⌘⇧Z takes it away again.
 *
 * Soft deletes, like every other removal here, and positions are kept. That is
 * what makes the undo safe: `nextPosition` counts deleted rows too, so passages
 * written after a rewind take fresh numbers and can never collide with the ones
 * the rewind is holding.
 *
 * Only the takes that were showing are cut. An inactive sibling of a rewound
 * slot is already invisible, and leaving it alone means undo restores the slot
 * exactly as the writer left it rather than as a slot with two live takes.
 *
 * Note this is NOT the "Retry from here" that used to live in the actions.
 * Nothing is regenerated and nothing branches: the writer is choosing where the
 * story ends, and the passages after it are reversibly set aside.
 */
export const rewindToEntry: Service<RewindToEntryInput, null> = async (raw) => {
  // Same guard as deleteEntry, and the one that matters most here: a rewind
  // from a device that isn't mirroring the run would cut the tail the run is
  // still writing into, and the passage the writer is paying for is dropped.
  const running = refuseRun(raw.storyId)
  if (running) return running
  const parsed = parseInput(rewindToEntryInput, raw)
  if (!parsed.ok) return parsed
  const { storyId, entryId } = parsed.data

  const db = await getDb()
  const now = new Date().toISOString()

  const result = await db.transaction(async (tx): Promise<ServiceResult> => {
    // The anchor has to be a passage the writer can actually see: rewinding to
    // a deleted row or an inactive take would cut from a position nothing is
    // rendered at, and the count in the confirmation would have been a guess
    // about a different manuscript.
    const anchor = await tx
      .select({ position: storyEntries.position })
      .from(storyEntries)
      .where(
        and(
          eq(storyEntries.id, entryId),
          eq(storyEntries.storyId, storyId),
          eq(storyEntries.isActive, true),
          isNull(storyEntries.deletedAt)
        )
      )
      .limit(1)
      .then((rows) => rows[0])

    if (!anchor) return fail("not_found", "Passage not found.")

    // One statement, and the ids come back from it: a SELECT-then-UPDATE would
    // record an op naming rows a concurrent delete had already taken, and undo
    // would then restore a passage the writer deleted on another device.
    const removed = await tx
      .update(storyEntries)
      .set({ deletedAt: now })
      .where(
        and(
          eq(storyEntries.storyId, storyId),
          gt(storyEntries.position, anchor.position),
          eq(storyEntries.isActive, true),
          isNull(storyEntries.deletedAt)
        )
      )
      .returning({ id: storyEntries.id })

    // The button is only rendered on a passage with prose after it, so this is
    // a stale render or a forged call — and an op naming no rows would be an
    // undo step that does nothing when taken.
    if (removed.length === 0)
      return fail("conflict", "There's nothing after this passage.")

    await recordOp(tx, storyId, {
      kind: "rewind",
      entryIds: removed.map((row) => row.id),
    })
    await touchStoryRow(tx, storyId, now)

    return ok(null)
  })

  if (result.ok) commitChange(storyId)
  return result
}

/** How many passages one scroll-up fetch brings in. Sized for the COMMIT,
 * not the wire: mounting a page of passages is the expensive half of a
 * landing, and the fetch-ahead pipeline in the canvas keeps the next page
 * buffered, so smaller pages cost nothing in throughput. */
const OLDER_PAGE_SIZE = 25

/**
 * One page of older passages for the canvas, walking backward from the
 * loaded window's start. A pure read: no revalidate, no journal — paging
 * through the manuscript is not a change to it.
 */
export const loadOlderEntries: Service<
  LoadOlderEntriesInput,
  OlderEntriesPage
> = async (raw) => {
  const parsed = parseInput(loadOlderEntriesInput, raw)
  if (!parsed.ok) return parsed
  const { storyId, beforePosition, limit } = parsed.data

  try {
    const page = await listOlderEntries(
      storyId,
      beforePosition,
      // Clamped: `limit` is client input, and the one caller that passes it
      // (the staleness refetch) asks for exactly what it already holds.
      Math.max(1, Math.min(limit ?? OLDER_PAGE_SIZE, 500))
    )
    return ok(page)
  } catch {
    return fail("failed", "Could not load earlier passages.")
  }
}

/**
 * What this passage was shown, composed from the story truncated to just
 * before it.
 *
 * Deliberately NOT read from a stored record of the original request. Keeping
 * one would be exact, and it would also be blank for every passage written
 * before it existed — which is most of any real manuscript. This composes the
 * same way a Retry of this passage would: the manuscript up to it, and the
 * lorebook, memory, author's note and window AS THEY STAND. That makes it an
 * answer about the present ("what would this passage be sent now"), which is
 * the actionable question, and the viewer says so rather than presenting it as
 * a record.
 *
 * The prose half is faithful whatever has changed since — every passage is on
 * disk in order, so the story the model saw is reconstructible exactly. What
 * drifts is everything on the mutable story row: edit a lore entry or move the
 * window and this answer moves with it, by design.
 *
 * Truncating by INDEX rather than by id-matching covers a retried passage for
 * free: story.entries holds one active take per slot in position order, so
 * everything before the take is everything before its slot — which is the same
 * filter startGeneration applies when it composes a retry.
 *
 * `ok` with null data is the ordinary answer for a passage that is no longer in
 * the manuscript (deleted, or an inactive take), not a failure.
 */
export const loadEntryContext: Service<
  LoadEntryContextInput,
  EntryContext | null
> = async (raw) => {
  const parsed = parseInput(loadEntryContextInput, raw)
  if (!parsed.ok) return parsed
  const { storyId, entryId } = parsed.data

  try {
    const [story, lorebookEntries, models] = await Promise.all([
      // Full manuscript, deliberately: this viewer answers "what was this
      // passage told", and the passage may sit anywhere in the story.
      getStoryFull(storyId),
      listLorebookEntries(storyId),
      // Cached for an hour in-process, so this is nearly free — see models.ts.
      listModels(),
    ])
    if (!story) return fail("not_found", "Story not found.")

    const index = story.entries.findIndex((entry) => entry.id === entryId)
    if (index === -1) return ok(null)

    // The same clamp startGeneration applies, for the same reason: the stored
    // window can outlive the model that justified it, and a viewer composed
    // against a budget no request would use is worse than no viewer.
    const endpoints =
      story.settings.providerTag == null
        ? []
        : await listModelEndpoints(story.settings.modelId)
    const contextWindow = clampContextWindow(
      story.settings.contextWindow,
      endpointForTag(endpoints, story.settings.providerTag)?.contextLength ??
        models.find((m) => m.id === story.settings.modelId)?.contextLength ??
        0
    )

    return ok({
      context: composeContext({
        story: { ...story, entries: story.entries.slice(0, index) },
        lorebookEntries,
        contextWindow,
      }),
      contextWindow,
      // Never today's model as a stand-in: a guess here is indistinguishable
      // from a recorded fact, which is the one thing provenance may not be.
      modelId: story.entries[index].generation?.modelId ?? null,
    })
  } catch (err) {
    console.error("[context] failed to compose a passage's context", err)
    return fail("failed", "Couldn't work out the context for this passage.")
  }
}
