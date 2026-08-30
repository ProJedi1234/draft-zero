// lib/store/store.ts — The normalized client cache: eight LWW tables, a
// pending-mutation overlay, and the derived view the surfaces render from.
//
// Client-safe and isomorphic. No React (types only, and not even those), no
// server imports, no window/document/navigator access — the whole file has to
// load under `bun test`, because the reducers below ARE the specification of
// how two devices converge and the tests are the only place that gets proved.
//
// Two tables are populated: `story`, which is the whole library and reconciles
// as one, and `lorebook-entry`, which is PARTITIONED BY STORY — no device ever
// holds every story's lore, so "complete" is a fact about one story's slice
// rather than the table. That is the only structural difference between them,
// and applyPartitionSnapshot plus partitionStatus below are the whole of it.
//
// Two version comparators live here on purpose. EVENTS arbitrate on strict `>`:
// the server mints stories.updated_at inside the UPDATE (lib/db/story-version),
// so it cannot produce two different row states at one version, which makes an
// equal-version event an echo of what we already hold. SNAPSHOTS arbitrate on
// `>=`: a snapshot row is read straight from the database, so adopting it is
// how a client that somehow diverged at an equal version heals instead of
// staying wrong forever.

import type {
  EntityKind,
  EntityRecordMap,
  LorebookEntryRecord,
  StoryRecord,
} from "@/lib/store/records"
import type {
  CanonicalRow,
  QueuedMutation,
  StorePatch,
} from "@/lib/store/mutation-queue"
import type { EntityWireEvent } from "@/lib/sync/types"

/** How long a tombstone outlives its delete before the sweep collects it. */
export const TOMBSTONE_TTL_MS = 600_000

export interface VersionedRow<T> {
  row: T
  version: string
  /** Local monotonic counter stamped at adoption — the deletion sweep's key. */
  ingestSeq: number
}

/**
 * empty: nothing yet · cache: IndexedDB rows adopted, no complete snapshot yet
 * live: at least one complete (full or delta) snapshot applied.
 */
export type TableStatus = "empty" | "cache" | "live"

export interface Tombstone {
  version: string
  /** Date.now() when recorded — the TTL GC's key. */
  at: number
}

export interface TableState<T> {
  rows: Map<string, VersionedRow<T>>
  tombstones: Map<string, Tombstone>
  status: TableStatus
}

type EntityTables = {
  [K in EntityKind]: TableState<EntityRecordMap[K]>
}

export interface StoreState extends EntityTables {
  pending: QueuedMutation[]
}

export interface SnapshotRow<T> {
  id: string
  version: string
  row: T
}

/** Allocates the ingest sequence stamped on an adoption. */
export type SeqAlloc = () => number

export function emptyTable<T>(): TableState<T> {
  return { rows: new Map(), tombstones: new Map(), status: "empty" }
}

// ---------------------------------------------------------------------------
// Pure reducers (design doc §3.2). Every one returns the SAME object when
// nothing changed, so the store's dirty flag and React's identity checks agree.
// ---------------------------------------------------------------------------

/**
 * Rule 1 (event upsert) + rule 2 (upsert vs tombstone). Events only — a
 * snapshot row goes through applySnapshot/applyScopedResult, which adopt on
 * `>=`.
 */
export function adoptUpsert<T>(
  table: TableState<T>,
  id: string,
  version: string,
  row: T,
  seq: number
): TableState<T> {
  // Rule 2: a tombstone at or past this version means the delete wins.
  const tombstone = table.tombstones.get(id)
  if (tombstone !== undefined && tombstone.version >= version) return table

  // Rule 1: adopt iff we hold nothing, or the event is strictly newer.
  const existing = table.rows.get(id)
  if (existing !== undefined && version <= existing.version) return table

  const rows = new Map(table.rows)
  rows.set(id, { row, version, ingestSeq: seq })
  const tombstones = clearTombstone(table.tombstones, id, tombstone)
  return { rows, tombstones, status: table.status }
}

/** Rule 3 (event delete): drop the row, remember the deletion. */
export function adoptDelete<T>(
  table: TableState<T>,
  id: string,
  version: string,
  nowMs: number
): TableState<T> {
  const existing = table.rows.get(id)
  const tombstone = table.tombstones.get(id)
  if (
    existing === undefined &&
    tombstone !== undefined &&
    tombstone.version >= version
  ) {
    return table
  }

  const rows = new Map(table.rows)
  rows.delete(id)
  const tombstones = new Map(table.tombstones)
  const keep =
    tombstone !== undefined && tombstone.version > version
      ? tombstone.version
      : version
  tombstones.set(id, { version: keep, at: nowMs })
  return { rows, tombstones, status: table.status }
}

/**
 * Rule 4 (complete apply). `issueSeq` is the ingest counter's value captured
 * when the REQUEST WAS ISSUED, which is what makes the sweep safe: a row the
 * client learned about while the request was in flight has a higher seq, and
 * the snapshot's silence about it proves nothing.
 */
export function applySnapshot<T>(
  table: TableState<T>,
  rows: ReadonlyArray<SnapshotRow<T>>,
  allIds: ReadonlySet<string>,
  issueSeq: number,
  protectedIds: ReadonlySet<string>,
  nowMs: number,
  seqAlloc: SeqAlloc
): TableState<T> {
  let next = table
  for (const entry of rows) {
    next = adoptSnapshotRow(next, entry, seqAlloc)
  }

  const nextRows = new Map(next.rows)
  const nextTombstones = new Map(next.tombstones)
  let swept = false
  for (const [id, held] of next.rows) {
    if (allIds.has(id)) continue
    // (a) target of a pending optimistic create, (b) learned in flight.
    if (protectedIds.has(id)) continue
    if (held.ingestSeq > issueSeq) continue
    nextRows.delete(id)
    nextTombstones.set(id, { version: held.version, at: nowMs })
    swept = true
  }

  // Tombstone TTL GC rides the sweep — the only place with a fresh clock and a
  // reason to walk the map.
  const cutoff = nowMs - TOMBSTONE_TTL_MS
  let gcd = false
  for (const [id, tombstone] of nextTombstones) {
    if (tombstone.at >= cutoff) continue
    nextTombstones.delete(id)
    gcd = true
  }

  if (!swept && !gcd && next.status === "live") return next
  return { rows: nextRows, tombstones: nextTombstones, status: "live" }
}

/**
 * Rule 5 (scoped apply): the asked-for ids we got nothing back for are
 * deletions — but only if we did not learn about them after the request went
 * out. Status is untouched; a scoped read is not a complete picture.
 */
export function applyScopedResult<T>(
  table: TableState<T>,
  ids: ReadonlyArray<string>,
  rows: ReadonlyArray<SnapshotRow<T>>,
  issueSeq: number,
  nowMs: number,
  seqAlloc: SeqAlloc
): TableState<T> {
  let next = table
  for (const entry of rows) {
    next = adoptSnapshotRow(next, entry, seqAlloc)
  }

  const returned = new Set(rows.map((entry) => entry.id))
  for (const id of ids) {
    if (returned.has(id)) continue
    const held = next.rows.get(id)
    if (held === undefined || held.ingestSeq > issueSeq) continue
    next = adoptDelete(next, id, held.version, nowMs)
  }
  return next
}

/**
 * Rule 4, narrowed to one partition — the read that says "this is ALL of story
 * X's lore" and nothing at all about story Y's.
 *
 * The sweep is the only part that differs from applySnapshot: it considers only
 * held rows that `belongs` accepts, so a complete read of one story can never
 * collect another story's rows as absent. `issueSeq` and `protectedIds` guard
 * it exactly as they guard the table-wide sweep, and for the same two reasons —
 * a row learned about in flight, and a row a pending create is still placing.
 *
 * Status is left alone. A partition being live is not the table being live, so
 * that fact is tracked per partition (see partitionStatus) rather than here.
 */
export function applyPartitionSnapshot<T>(
  table: TableState<T>,
  rows: ReadonlyArray<SnapshotRow<T>>,
  belongs: (row: T) => boolean,
  issueSeq: number,
  protectedIds: ReadonlySet<string>,
  nowMs: number,
  seqAlloc: SeqAlloc
): TableState<T> {
  let next = table
  for (const entry of rows) {
    next = adoptSnapshotRow(next, entry, seqAlloc)
  }

  const returned = new Set(rows.map((entry) => entry.id))
  const nextRows = new Map(next.rows)
  const nextTombstones = new Map(next.tombstones)
  let swept = false
  for (const [id, held] of next.rows) {
    if (returned.has(id)) continue
    if (!belongs(held.row)) continue
    if (protectedIds.has(id)) continue
    if (held.ingestSeq > issueSeq) continue
    nextRows.delete(id)
    nextTombstones.set(id, { version: held.version, at: nowMs })
    swept = true
  }

  if (!swept) return next
  return { rows: nextRows, tombstones: nextTombstones, status: next.status }
}

/**
 * Rule 7 (cache adoption): IndexedDB is a cache, not an authority, so strict
 * `>` and the status ladder only ever climbs empty → cache.
 */
export function adoptCache<T>(
  table: TableState<T>,
  rows: ReadonlyArray<SnapshotRow<T>>,
  seqAlloc: SeqAlloc
): TableState<T> {
  let next = table
  for (const entry of rows) {
    next = adoptUpsert(next, entry.id, entry.version, entry.row, seqAlloc())
  }
  if (next.status !== "empty") return next
  return { rows: next.rows, tombstones: next.tombstones, status: "cache" }
}

/** Snapshot adoption: rule 4/5's `>=`, still subject to rule 2's tombstone. */
function adoptSnapshotRow<T>(
  table: TableState<T>,
  entry: SnapshotRow<T>,
  seqAlloc: SeqAlloc
): TableState<T> {
  const tombstone = table.tombstones.get(entry.id)
  if (tombstone !== undefined && tombstone.version >= entry.version) {
    return table
  }

  const existing = table.rows.get(entry.id)
  if (existing !== undefined && entry.version < existing.version) return table

  const rows = new Map(table.rows)
  rows.set(entry.id, {
    row: entry.row,
    version: entry.version,
    ingestSeq: seqAlloc(),
  })
  const tombstones = clearTombstone(table.tombstones, entry.id, tombstone)
  return { rows, tombstones, status: table.status }
}

function clearTombstone(
  tombstones: Map<string, Tombstone>,
  id: string,
  found: Tombstone | undefined
): Map<string, Tombstone> {
  if (found === undefined) return tombstones
  const next = new Map(tombstones)
  next.delete(id)
  return next
}

// ---------------------------------------------------------------------------
// Derived view (design doc §3.3)
// ---------------------------------------------------------------------------

export interface StoryView extends StoryRecord {
  pending: boolean
}

export interface StoreView {
  stories: StoryView[]
  storyById: ReadonlyMap<string, StoryView>
  storyStatus: TableStatus
  pendingCount: number
}

/**
 * Confirmed rows with the pending overlay folded on top, sorted so anything a
 * pending mutation touched leads — most recently enqueued first, which is where
 * the server's own updatedAt bump will put it on confirm. Merge patches carry
 * no updatedAt (§4.3) and this must not invent one: a client clock has no
 * business producing a value that gets compared against server-minted versions.
 */
export function deriveStoryView(
  confirmed: TableState<StoryRecord>,
  pending: ReadonlyArray<QueuedMutation>
): StoreView {
  const visible = new Map<string, StoryRecord>()
  for (const [id, held] of confirmed.rows) visible.set(id, held.row)

  /** id → index of the LAST pending mutation that touched it. */
  const touched = new Map<string, number>()

  pending.forEach((mutation, index) => {
    for (const patch of mutation.patches) {
      // One queue serves every table, so a lorebook patch rides in the same
      // list; folding it in here would invent a story row out of a lore row.
      if (patch.entity !== "story") continue
      const id = patchTargetId(patch)
      touched.set(id, index)
      if (patch.op === "upsert") {
        visible.set(id, patch.row)
      } else if (patch.op === "merge") {
        const current = visible.get(id)
        if (current === undefined) continue // a merge onto a deleted row is a no-op
        visible.set(id, { ...current, ...patch.fields })
      } else {
        visible.delete(id)
      }
    }
  })

  const stories: StoryView[] = []
  for (const [id, row] of visible) {
    stories.push({ ...row, pending: touched.has(id) })
  }

  stories.sort((a, b) => {
    const aTouch = touched.get(a.id)
    const bTouch = touched.get(b.id)
    if (aTouch !== undefined || bTouch !== undefined) {
      if (aTouch === undefined) return 1
      if (bTouch === undefined) return -1
      if (aTouch !== bTouch) return bTouch - aTouch
    }
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const storyById = new Map<string, StoryView>()
  for (const story of stories) storyById.set(story.id, story)

  return {
    stories,
    storyById,
    storyStatus: confirmed.status,
    pendingCount: pending.length,
  }
}

/** One story's lore, confirmed rows with the pending overlay folded on top. */
export interface LoreView {
  entries: LorebookEntryRecord[]
  /** Liveness of THIS story's partition, not of the table. */
  status: TableStatus
}

/**
 * The lorebook's twin of deriveStoryView, scoped to one story.
 *
 * Sorted by name to match listLorebookEntries' ORDER BY, so a row confirmed by
 * the server lands where the optimistic one already was and the list does not
 * jump under the writer. Ties break on id for a total order — two entries may
 * legitimately share a name.
 */
export function deriveLoreView(
  confirmed: TableState<LorebookEntryRecord>,
  pending: ReadonlyArray<QueuedMutation>,
  storyId: string,
  status: TableStatus
): LoreView {
  const visible = new Map<string, LorebookEntryRecord>()
  for (const [id, held] of confirmed.rows) {
    if (held.row.storyId !== storyId) continue
    visible.set(id, held.row)
  }

  for (const mutation of pending) {
    for (const patch of mutation.patches) {
      if (patch.entity !== "lorebook-entry") continue
      if (patch.op === "upsert") {
        // A create for another story must not surface in this one's list.
        if (patch.row.storyId !== storyId) continue
        visible.set(patch.row.id, patch.row)
      } else if (patch.op === "merge") {
        const current = visible.get(patch.id)
        if (current === undefined) continue // merge onto a deleted row: no-op
        visible.set(patch.id, { ...current, ...patch.fields })
      } else {
        visible.delete(patch.id)
      }
    }
  }

  const entries = [...visible.values()]
  entries.sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  return { entries, status }
}

function patchTargetId(patch: StorePatch): string {
  return patch.op === "upsert" ? patch.row.id : patch.id
}

// ---------------------------------------------------------------------------
// The singleton
// ---------------------------------------------------------------------------

const EMPTY_VIEW: StoreView = Object.freeze({
  stories: [] as StoryView[],
  storyById: new Map<string, StoryView>(),
  storyStatus: "empty" as TableStatus,
  pendingCount: 0,
})

/**
 * The tables a client actually holds. Everything else in EntityKind is typed
 * ahead of its migration and deliberately ignored on the wire.
 */
const POPULATED = new Set<EntityKind>(["story", "lorebook-entry"])
type PopulatedKind = "story" | "lorebook-entry"

function partitionKey(storyId: string): string {
  return `lorebook-entry:${storyId}`
}

function emptyState(): StoreState {
  return {
    story: emptyTable<StoryRecord>(),
    "story-entry": emptyTable(),
    "story-image": emptyTable(),
    "lorebook-entry": emptyTable(),
    "story-recap": emptyTable(),
    "model-profile": emptyTable(),
    "app-settings": emptyTable(),
    "composer-draft": emptyTable(),
    pending: [],
  }
}

interface StoreHolder {
  state: StoreState
  seq: number
  version: number
  lastCompleteApplyAt: number
  listeners: Set<() => void>
  view: StoreView | null
  /** `${entity}:${partitionId}` → liveness of that slice. See PARTITIONED. */
  partitionStatus: Map<string, TableStatus>
  /** Lore views by story id, rebuilt whenever `version` moves past `at`. */
  loreViews: Map<string, { at: number; view: LoreView }>
}

// Held on globalThis for exactly the reason lib/sync/bus.ts holds its listener
// Set there: dev HMR reloads this module while the mounted tree keeps its
// subscriptions, and a fresh empty store with nothing scheduled to refill it
// strands every surface on a skeleton until a hard reload.
const globalForStore = globalThis as unknown as {
  __draftZeroStore: StoreHolder | undefined
}

const holder = (globalForStore.__draftZeroStore ??= {
  state: emptyState(),
  seq: 0,
  version: 0,
  lastCompleteApplyAt: 0,
  listeners: new Set<() => void>(),
  view: null,
  partitionStatus: new Map<string, TableStatus>(),
  loreViews: new Map<string, { at: number; view: LoreView }>(),
})

function nextIngestSeq(): number {
  return ++holder.seq
}

function markDirty(): void {
  holder.view = null
  // Cleared rather than pruned: a change to any table can move a lore view
  // (the pending overlay is one list), and rebuilding one is a sort of a few
  // hundred rows.
  holder.loreViews.clear()
  holder.version += 1
  for (const listener of holder.listeners) {
    try {
      listener()
    } catch {
      // One broken subscriber must not mute the rest, same as the bus.
    }
  }
}

/**
 * Ids a pending mutation is trying to CREATE in `entity` — the sweep must spare
 * them. Scoped by table: a snapshot of one table has nothing to say about a row
 * being created in another, and sparing a foreign id would only mask a delete.
 */
function pendingCreatedIds(entity: EntityKind): Set<string> {
  const ids = new Set<string>()
  for (const mutation of holder.state.pending) {
    for (const patch of mutation.patches) {
      if (patch.entity !== entity) continue
      if (patch.op === "upsert") ids.add(patch.row.id)
    }
  }
  return ids
}

export const clientStore = {
  subscribe(callback: () => void): () => void {
    holder.listeners.add(callback)
    return () => {
      holder.listeners.delete(callback)
    }
  },

  /** Stable identity between changes — useSyncExternalStore depends on it. */
  getView(): StoreView {
    if (holder.view === null) {
      holder.view = deriveStoryView(holder.state.story, holder.state.pending)
    }
    return holder.view
  },

  getServerView(): StoreView {
    return EMPTY_VIEW
  },

  /** Bumped on every notify; the cheapest thing a test can assert on. */
  getVersion(): number {
    return holder.version
  },

  currentIngestSeq(): number {
    return holder.seq
  },

  /** 0 until a complete snapshot lands — the persistence write stamp (§7). */
  getLastCompleteApplyAt(): number {
    return holder.lastCompleteApplyAt
  },

  /** The delta reconcile's `since` input. */
  maxStoryVersion(): string | null {
    let max: string | null = null
    for (const held of holder.state.story.rows.values()) {
      if (max === null || held.version > max) max = held.version
    }
    return max
  },

  /** Read-only escape hatch for tests and selectors that need raw tables. */
  getState(): StoreState {
    return holder.state
  },

  ingest(event: EntityWireEvent): void {
    // Only the populated tables. The other six kinds are typed so a later
    // migration is additive, and ignored until then — an event for one is not
    // an error, it is news for a table nobody reads yet.
    if (!POPULATED.has(event.entity)) return
    const entity = event.entity as PopulatedKind
    const table = holder.state[entity] as TableState<unknown>
    const next =
      event.op === "upsert"
        ? adoptUpsert(
            table,
            event.id,
            event.version,
            event.data as unknown,
            nextIngestSeq()
          )
        : adoptDelete(table, event.id, event.version, Date.now())
    if (next === table) return
    holder.state = { ...holder.state, [entity]: next }
    markDirty()
  },

  /**
   * A complete read of ONE story's lore. Rows absent from it are deletions for
   * that story and no other — see applyPartitionSnapshot.
   */
  applyLoreSnapshot(
    storyId: string,
    rows: ReadonlyArray<SnapshotRow<LorebookEntryRecord>>,
    issueSeq: number
  ): void {
    const table = holder.state["lorebook-entry"]
    const next = applyPartitionSnapshot(
      table,
      rows,
      (row) => row.storyId === storyId,
      issueSeq,
      pendingCreatedIds("lorebook-entry"),
      Date.now(),
      nextIngestSeq
    )
    const key = partitionKey(storyId)
    const wasLive = holder.partitionStatus.get(key) === "live"
    holder.partitionStatus.set(key, "live")
    if (next === table && wasLive) return
    holder.state = { ...holder.state, "lorebook-entry": next }
    markDirty()
  },

  /**
   * Lore lifted from a workspace payload — the story route already fetched it,
   * so arriving at the lorebook costs nothing. A payload IS a complete read of
   * that story's lore (same query, same request), so it counts as one.
   */
  adoptLorePayload(
    storyId: string,
    entries: ReadonlyArray<LorebookEntryRecord>,
    issueSeq: number
  ): void {
    clientStore.applyLoreSnapshot(
      storyId,
      entries.map((row) => ({ id: row.id, version: row.updatedAt, row })),
      issueSeq
    )
  },

  /** Cache adoption for lore, from IndexedDB. Never authoritative (rule 7). */
  adoptLoreCacheRows(
    rows: ReadonlyArray<SnapshotRow<LorebookEntryRecord>>
  ): void {
    const table = holder.state["lorebook-entry"]
    const next = adoptCache(table, rows, nextIngestSeq)
    if (next === table) return
    holder.state = { ...holder.state, "lorebook-entry": next }
    markDirty()
  },

  /** Every held lore row, for the persister. Confirmed only, like stories. */
  confirmedLoreRows(): SnapshotRow<LorebookEntryRecord>[] {
    const rows: SnapshotRow<LorebookEntryRecord>[] = []
    for (const [id, held] of holder.state["lorebook-entry"].rows) {
      rows.push({ id, version: held.version, row: held.row })
    }
    return rows
  },

  /**
   * One story's lore, memoized against the store version so a component that
   * re-renders on every store change does not re-sort on each of them.
   */
  getLoreView(storyId: string): LoreView {
    const cached = holder.loreViews.get(storyId)
    if (cached !== undefined && cached.at === holder.version) return cached.view
    const view = deriveLoreView(
      holder.state["lorebook-entry"],
      holder.state.pending,
      storyId,
      holder.partitionStatus.get(partitionKey(storyId)) ??
        // Cache rows are a real paint but not a complete read — the same
        // empty/cache/live ladder the tables use, one partition at a time.
        (holder.state["lorebook-entry"].status === "empty" ? "empty" : "cache")
    )
    holder.loreViews.set(storyId, { at: holder.version, view })
    return view
  },

  applySnapshot(
    rows: ReadonlyArray<SnapshotRow<StoryRecord>>,
    allIds: ReadonlySet<string>,
    issueSeq: number
  ): void {
    const table = holder.state.story
    const next = applySnapshot(
      table,
      rows,
      allIds,
      issueSeq,
      pendingCreatedIds("story"),
      Date.now(),
      nextIngestSeq
    )
    // Recorded even when nothing moved: the stamp says when this tab last
    // reconciled, not when it last changed.
    holder.lastCompleteApplyAt = Date.now()
    if (next === table) return
    holder.state = { ...holder.state, story: next }
    markDirty()
  },

  applyScopedResult(
    ids: ReadonlyArray<string>,
    rows: ReadonlyArray<SnapshotRow<StoryRecord>>,
    issueSeq: number
  ): void {
    const table = holder.state.story
    const next = applyScopedResult(
      table,
      ids,
      rows,
      issueSeq,
      Date.now(),
      nextIngestSeq
    )
    if (next === table) return
    holder.state = { ...holder.state, story: next }
    markDirty()
  },

  adoptCacheRows(rows: ReadonlyArray<SnapshotRow<StoryRecord>>): void {
    const table = holder.state.story
    const next = adoptCache(table, rows, nextIngestSeq)
    if (next === table) return
    holder.state = { ...holder.state, story: next }
    markDirty()
  },

  /** Only confirmed rows — the pending overlay is never persisted (§7). */
  confirmedStoryRows(): SnapshotRow<StoryRecord>[] {
    const rows: SnapshotRow<StoryRecord>[] = []
    for (const [id, held] of holder.state.story.rows) {
      rows.push({ id, version: held.version, row: held.row })
    }
    return rows
  },

  addPending(mutation: QueuedMutation): void {
    holder.state = {
      ...holder.state,
      pending: [...holder.state.pending, mutation],
    }
    markDirty()
  },

  /**
   * Fold the action's canonical rows into confirmed, then drop the overlay.
   * The fold uses the EVENT rule, which is what makes it idempotent with the
   * bus echo of the same write arriving before or after.
   */
  confirmPending(id: string, canonical: ReadonlyArray<CanonicalRow>): void {
    const now = Date.now()
    const tables: Partial<Record<PopulatedKind, TableState<unknown>>> = {}
    for (const entry of canonical) {
      if (!POPULATED.has(entry.entity)) continue
      const entity = entry.entity as PopulatedKind
      const table = (tables[entity] ??
        holder.state[entity]) as TableState<unknown>
      tables[entity] =
        entry.op === "upsert"
          ? adoptUpsert(
              table,
              entry.id,
              entry.version,
              entry.row as unknown,
              nextIngestSeq()
            )
          : adoptDelete(table, entry.id, entry.version, now)
    }
    holder.state = {
      ...holder.state,
      ...tables,
      pending: holder.state.pending.filter((m) => m.id !== id),
    } as StoreState
    markDirty()
  },

  /** Rollback: dropping the overlay entry IS the undo. */
  dropPending(id: string): void {
    const pending = holder.state.pending.filter((m) => m.id !== id)
    if (pending.length === holder.state.pending.length) return
    holder.state = { ...holder.state, pending }
    markDirty()
  },

  reset(): void {
    holder.state = emptyState()
    holder.seq = 0
    holder.lastCompleteApplyAt = 0
    holder.view = null
    holder.partitionStatus.clear()
    holder.loreViews.clear()
    holder.version += 1
  },
}
