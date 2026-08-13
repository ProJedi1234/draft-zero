"use server"

import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import type { DrizzleDb, DrizzleTx } from "@/lib/db/client"
import { getDb } from "@/lib/db/client"
import { recordOp } from "@/lib/db/journal"
import { toStoryEntry } from "@/lib/db/mappers"
import type { StoryEntryRow } from "@/lib/db/schema"
import { stories, storyEntries } from "@/lib/db/schema"
import type { EntryProse } from "@/lib/history/ops"
import { translateAction } from "@/lib/story/action-voice"
import type {
  ActionKind,
  ActionResult,
  EntryGeneration,
  EntrySource,
  StoryEntry,
} from "@/lib/types"

/**
 * Every mutator below writes its row and records the op that describes it in
 * ONE transaction. The two are the same fact told twice — a row change and the
 * history's account of it — and a history that disagrees with the rows is worse
 * than no history: undo would either do nothing or reverse something the writer
 * never did. So the helpers here all take the `tx`/`db` handle rather than
 * reaching for `getDb()` themselves.
 */
type Handle = DrizzleDb | DrizzleTx

async function storyExists(db: Handle, storyId: string): Promise<boolean> {
  const row = await db
    .select({ id: stories.id })
    .from(stories)
    .where(eq(stories.id, storyId))
    .limit(1)
    .then((rows) => rows[0])
  return Boolean(row)
}

async function touchStory(db: Handle, storyId: string, now: string) {
  await db
    .update(stories)
    .set({ updatedAt: now })
    .where(eq(stories.id, storyId))
}

/**
 * The next free position, counting EVERY row of the story — soft-deleted rows
 * and inactive takes included. Those rows keep their `position` (that is what
 * makes restoring them a plain UPDATE), so handing their number out again would
 * put two live passages in one slot the moment one of them came back.
 */
async function nextPosition(db: Handle, storyId: string): Promise<number> {
  const row = await db
    .select({ max: sql<number | null>`MAX(${storyEntries.position})` })
    .from(storyEntries)
    .where(eq(storyEntries.storyId, storyId))
    .then((rows) => rows[0])
  const max = row?.max
  return max === null || max === undefined ? 0 : max + 1
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
 * The one write path for an *appended* passage: position, provenance, the turn
 * op, the story touch and the revalidate all live here so a caller can never
 * append a row that the sidebar's updatedAt ordering, the manuscript's cache or
 * the undo journal misses. (Two callers build rows of their own instead of
 * appending to a live story — the importer writes position 0 inside its own
 * transaction, and the seed script writes a whole story at once. Neither is a
 * writer's move, so neither records history.)
 *
 * `action` carries the player-turn columns and is null for everything else. The
 * pair travels together because actionKind and inputText are only ever both set
 * or both null — see the StoryEntry doc comment.
 *
 * `turnId` is what makes a Send and the passage it produced a single ⌘Z: both
 * halves are appended under the same id and `recordOp` folds the second into
 * the op the first one wrote, instead of stacking two steps the writer would
 * have to undo twice.
 */
async function appendEntry(
  storyId: string,
  text: string,
  source: EntrySource,
  opts: {
    action?: { kind: ActionKind; inputText: string } | null
    /**
     * Off only for the writer's own turn — see appendActionEntry. Everything
     * else revalidates here, because for every other caller this row is the
     * last thing that happens and nothing else will refresh the tree.
     */
    revalidate?: boolean
    turnId?: string | null
    generation?: EntryGeneration | null
  } = {}
): Promise<ActionResult<{ entry: StoryEntry }>> {
  const trimmed = text.trim()
  if (trimmed === "")
    return { ok: false, error: "Nothing to add — write something first." }

  const db = await getDb()
  if (!(await storyExists(db, storyId)))
    return { ok: false, error: "Story not found." }

  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  const generation = opts.generation ?? null

  const row: StoryEntryRow = {
    id,
    storyId,
    position: await nextPosition(db, storyId),
    source,
    text: trimmed,
    actionKind: opts.action?.kind ?? null,
    inputText: opts.action?.inputText ?? null,
    // A fresh append starts its own slot, so the slot's id is the row's own id
    // and it is the only take in it. A retry goes through
    // appendGeneratedEntry's other branch, which joins an existing slot.
    variantGroupId: id,
    variantIndex: 0,
    isActive: true,
    deletedAt: null,
    genModelId: generation?.modelId ?? null,
    genThinking: generation?.thinking ?? null,
    genTemperature: generation?.temperature ?? null,
    promptTokens: generation?.promptTokens ?? null,
    completionTokens: generation?.completionTokens ?? null,
    createdAt: now,
  }

  await db.transaction(async (tx) => {
    await tx.insert(storyEntries).values(row)
    // Which half of the turn this row is follows from its source: the writer's
    // action or the passage the model produced. The other half stays null until
    // (and unless) it is written — a generation that dies mid-stream leaves a
    // turn with only its user half, which still has to undo cleanly.
    await recordOp(
      tx,
      storyId,
      {
        kind: "turn",
        userEntryId: source === "user" ? id : null,
        generatedEntryId: source === "generated" ? id : null,
      },
      opts.turnId ?? null
    )
    await touchStory(tx, storyId, now)
  })

  if (opts.revalidate !== false) revalidatePath("/", "layout")
  return {
    ok: true,
    data: { entry: toStoryEntry(row, { index: 0, count: 1 }) },
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
 * Deliberately does NOT revalidate, and its one caller (prepareGeneration) owns
 * that instead. This insert sits in the critical path between the writer
 * pressing Send and the first token: revalidating here makes the server
 * re-render the whole layout and ship it back before generation can even start,
 * for a row the canvas is already showing a byte-identical echo of. useGeneration
 * refreshes the tree exactly once, when the turn settles — and on every failure
 * path too, so this row can never stay invisible.
 */
export async function appendActionEntry(
  storyId: string,
  kind: ActionKind,
  rawText: string,
  turnId?: string | null
): Promise<ActionResult<{ entry: StoryEntry }>> {
  const raw = rawText.trim()
  if (raw === "")
    return { ok: false, error: "Nothing to add — write something first." }

  const translated = translateAction(kind, raw)
  if (translated.trim() === "")
    return { ok: false, error: "Nothing to add — write something first." }

  return appendEntry(storyId, translated, "user", {
    action: { kind, inputText: raw },
    revalidate: false,
    turnId,
  })
}

/**
 * Appends a generated passage — called by the client after streaming completes.
 *
 * Two shapes, and `variantGroupId` is what tells them apart:
 *
 * - Without one, this is the ordinary end of a turn: a new passage at the end
 *   of the manuscript, recorded onto the turn op the writer's Send opened.
 * - With one, this is a Retry. The passage is not new prose at a new position,
 *   it is another take of a slot that already exists, so it lands at that
 *   slot's *same* position and the take that was showing steps aside.
 *
 * Retry deliberately never deletes and never truncates the story: only the last
 * block can be regenerated (see deleteEntriesFrom's headstone below), so a
 * retry can only ever add a take to a slot nothing follows.
 */
export async function appendGeneratedEntry(
  storyId: string,
  text: string,
  opts: {
    turnId?: string | null
    variantGroupId?: string
    generation?: EntryGeneration | null
  } = {}
): Promise<ActionResult<{ entry: StoryEntry }>> {
  if (opts.variantGroupId === undefined) {
    return appendEntry(storyId, text, "generated", {
      turnId: opts.turnId,
      generation: opts.generation,
    })
  }
  return appendRetryTake(
    storyId,
    text,
    opts.variantGroupId,
    opts.generation ?? null
  )
}

/**
 * A retry: a new take inserted beside the one that was showing, in the same
 * slot and at the same position.
 *
 * The ordering inside the transaction is load-bearing. The unique index on
 * (story_id, position) is partial — it covers exactly the rows that are live
 * and active — and every take of a slot shares one position, so the outgoing
 * take has to be deactivated BEFORE the new one is inserted. Insert first and
 * there are two active rows at that position for the width of a statement, and
 * Postgres rejects it outright.
 *
 * `variant_index` is `MAX + 1` over every take of the slot, including the ones
 * that are inactive or soft-deleted: the index is the order the takes were
 * *made* in, and reusing a departed take's number would make the switcher's
 * ordering depend on what happens to be visible.
 */
async function appendRetryTake(
  storyId: string,
  text: string,
  variantGroupId: string,
  generation: EntryGeneration | null
): Promise<ActionResult<{ entry: StoryEntry }>> {
  const trimmed = text.trim()
  if (trimmed === "")
    return { ok: false, error: "Nothing to add — write something first." }

  const db = await getDb()
  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  const result = await db.transaction(
    async (tx): Promise<ActionResult<{ entry: StoryEntry }>> => {
      // One query for the whole slot: the take to step aside, the highest index
      // so far, and how many takes the writer will be told the slot holds. All
      // three are facts about the same handful of rows and a manuscript's slot
      // is a handful at most.
      const takes = await tx
        .select({
          id: storyEntries.id,
          position: storyEntries.position,
          variantIndex: storyEntries.variantIndex,
          isActive: storyEntries.isActive,
          deletedAt: storyEntries.deletedAt,
        })
        .from(storyEntries)
        .where(
          and(
            eq(storyEntries.storyId, storyId),
            eq(storyEntries.variantGroupId, variantGroupId)
          )
        )
        .orderBy(asc(storyEntries.variantIndex))

      const previous = takes.find(
        (take) => take.isActive && take.deletedAt === null
      )
      // The slot vanished (or was undone) between the writer pressing Retry and
      // the stream finishing. There is no position to insert at and no take to
      // record as the one this replaced, so the honest answer is a refusal
      // rather than a passage dropped somewhere plausible.
      if (!previous)
        return { ok: false, error: "That passage is no longer in the story." }

      const maxIndex = takes.reduce(
        (highest, take) => Math.max(highest, take.variantIndex),
        0
      )
      const liveCount = takes.filter((take) => take.deletedAt === null).length

      const row: StoryEntryRow = {
        id,
        storyId,
        position: previous.position,
        source: "generated",
        text: trimmed,
        actionKind: null,
        inputText: null,
        variantGroupId,
        variantIndex: maxIndex + 1,
        isActive: true,
        deletedAt: null,
        genModelId: generation?.modelId ?? null,
        genThinking: generation?.thinking ?? null,
        genTemperature: generation?.temperature ?? null,
        promptTokens: generation?.promptTokens ?? null,
        completionTokens: generation?.completionTokens ?? null,
        createdAt: now,
      }

      await tx
        .update(storyEntries)
        .set({ isActive: false })
        .where(eq(storyEntries.id, previous.id))
      await tx.insert(storyEntries).values(row)
      await recordOp(tx, storyId, {
        kind: "retry",
        variantGroupId,
        previousEntryId: previous.id,
        newEntryId: id,
      })
      await touchStory(tx, storyId, now)

      return {
        ok: true,
        data: {
          // The new take is the newest, so it is last among the slot's live
          // takes — index `liveCount`, in a slot that now holds one more.
          entry: toStoryEntry(row, {
            index: liveCount,
            count: liveCount + 1,
          }),
        },
      }
    }
  )

  // After the commit, never inside it: the revalidation is a promise about rows
  // that are on disk, and a transaction that rolls back must not have told the
  // cache otherwise.
  if (result.ok) revalidatePath("/", "layout")
  return result
}

/**
 * Re-edits a player turn: the writer edits their own first-person input again,
 * and both columns are rewritten from it so the stored prose stays exactly
 * `translateAction(actionKind, inputText)`. Editing the translated text
 * directly (updateEntryText) would break that pair, leaving an inputText that
 * no longer explains the passage sitting beside it.
 *
 * The kind is read from the row rather than taken from the caller: it was
 * chosen when the turn was written and an edit is not a place to silently turn
 * a Do into a Say. A row without one is not a player turn at all — a generated
 * passage, or a user passage from before this feature — and there is nothing to
 * re-translate, so those go through updateEntryText.
 */
export async function updateActionEntry(
  storyId: string,
  entryId: string,
  rawText: string
): Promise<ActionResult> {
  const raw = rawText.trim()
  if (raw === "") return { ok: false, error: "A passage can't be empty." }

  const db = await getDb()
  const now = new Date().toISOString()

  const result = await db.transaction(async (tx): Promise<ActionResult> => {
    // Read inside the transaction, and read the whole prose: the kind decides
    // how to translate, and the text/inputText pair is the `before` the undo
    // journal has to be able to put back. Reading it outside would let another
    // tab's edit land in between and be silently swallowed by this one's undo.
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

    if (!existing) return { ok: false, error: "Passage not found." }
    if (existing.actionKind === null)
      return { ok: false, error: "This passage isn't a Say or Do." }

    const translated = translateAction(existing.actionKind, raw)
    if (translated.trim() === "")
      return { ok: false, error: "A passage can't be empty." }

    // The SELECT above read the prose, not a lock: the row can be soft-deleted
    // between the two statements (another tab's Delete), so the update has to
    // prove it landed the same way every other mutator here does.
    const updated = await tx
      .update(storyEntries)
      .set({ text: translated, inputText: raw })
      .where(
        and(eq(storyEntries.id, entryId), eq(storyEntries.storyId, storyId))
      )
      .returning({ id: storyEntries.id })

    if (updated.length === 0) return { ok: false, error: "Passage not found." }

    await recordOp(tx, storyId, {
      kind: "edit",
      entryId,
      before: proseOf(existing),
      // The kind is deliberately carried through unchanged: this path
      // re-translates, it never re-voices.
      after: {
        text: translated,
        actionKind: existing.actionKind,
        inputText: raw,
      },
    })
    await touchStory(tx, storyId, now)

    return { ok: true, data: null }
  })

  // See appendRetryTake: the cache is told only about a commit that happened.
  if (result.ok) revalidatePath("/", "layout")
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
 * The `before` recorded for undo therefore carries all three columns, not just
 * the text: undoing a hand-fix has to give the writer their Say back, not a
 * passage that reads right but has forgotten it was ever an action.
 */
export async function updateEntryText(
  storyId: string,
  entryId: string,
  text: string
): Promise<ActionResult> {
  const trimmed = text.trim()
  if (trimmed === "") return { ok: false, error: "A passage can't be empty." }

  const db = await getDb()
  const now = new Date().toISOString()

  const result = await db.transaction(async (tx): Promise<ActionResult> => {
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

    if (!existing) return { ok: false, error: "Passage not found." }

    const updated = await tx
      .update(storyEntries)
      .set({ text: trimmed, actionKind: null, inputText: null })
      .where(
        and(eq(storyEntries.id, entryId), eq(storyEntries.storyId, storyId))
      )
      .returning({ id: storyEntries.id })

    if (updated.length === 0) return { ok: false, error: "Passage not found." }

    await recordOp(tx, storyId, {
      kind: "edit",
      entryId,
      before: proseOf(existing),
      after: { text: trimmed, actionKind: null, inputText: null },
    })
    await touchStory(tx, storyId, now)

    return { ok: true, data: null }
  })

  if (result.ok) revalidatePath("/", "layout")
  return result
}

/**
 * Removes a passage from the manuscript — a soft delete, never a DELETE.
 *
 * The row keeps its `position` and everything else, so undo is a single UPDATE
 * back to `deleted_at = NULL` and nothing after it has to be renumbered. The
 * partial unique index ignores deleted rows, so the slot it vacates is free in
 * the meantime.
 *
 * Rows that are already deleted are excluded from the update rather than
 * treated as a success: a second Delete on the same passage would otherwise
 * record a second `delete` op, and undoing it would restore a passage the
 * writer had deleted twice and expected to stay gone.
 */
export async function deleteEntry(
  storyId: string,
  entryId: string
): Promise<ActionResult> {
  const db = await getDb()
  const now = new Date().toISOString()

  const result = await db.transaction(async (tx): Promise<ActionResult> => {
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

    if (deleted.length === 0) return { ok: false, error: "Passage not found." }

    await recordOp(tx, storyId, { kind: "delete", entryId })
    await touchStory(tx, storyId, now)

    return { ok: true, data: null }
  })

  if (result.ok) revalidatePath("/", "layout")
  return result
}

// `undoLastEntry` and `deleteEntriesFrom` used to live here, and both are gone
// on purpose rather than kept for compatibility.
//
// `undoLastEntry` deleted the newest row. Undo is now a journal (lib/db/journal
// .ts, lib/actions/history.ts) that reverses whatever the writer's last *move*
// was — which is usually more than one row and is not always an append — so a
// "delete the last row" action would be a second, disagreeing notion of undo.
//
// `deleteEntriesFrom` powered "Retry from here": it truncated the manuscript
// from a chosen block onwards so a new generation could take its place. That is
// branching, and branching is the thing this design removes. Regeneration is
// confined to the LAST block, where a retry is an alternative take added beside
// the one showing (appendRetryTake above) and nothing downstream exists to be
// destroyed. A writer who wants to regenerate from the middle deletes forward
// themselves, one reversible step at a time.
