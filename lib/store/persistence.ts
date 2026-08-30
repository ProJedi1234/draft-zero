// lib/store/persistence.ts — IndexedDB cache for the client store (design
// doc §7). Pure persistence layer: no React, no store.ts import (P5 wires
// this to clientStore). A cache of server truth, never authoritative — the
// worst a bad flush or a missed load can do is cost one snapshot fetch.

import type { EntityKind } from "@/lib/store/records"

export interface PersistedRow {
  id: string
  version: string
  row: unknown
}

/**
 * One story's workspace payload, held whole.
 *
 * Manuscripts are the only thing here big enough to need a budget: the story
 * ROWS are a few hundred bytes each and the sidebar's search depends on having
 * the entire library in memory, so those stay complete however many stories
 * there are. These do not — see WORKSPACE_CACHE_LIMIT.
 */
export interface PersistedWorkspace {
  id: string
  /** The payload's story.updatedAt, for telling a stale cache from a fresh one. */
  version: string
  savedAt: number
  payload: unknown
}

export interface StorePersistence {
  load(entity: EntityKind): Promise<PersistedRow[]>
  replaceAll(
    entity: EntityKind,
    rows: PersistedRow[],
    stamp: number
  ): Promise<void>
  loadWorkspaces(): Promise<PersistedWorkspace[]>
  putWorkspace(entry: PersistedWorkspace): Promise<void>
  /** Drops every workspace whose id is not listed. */
  keepWorkspaces(ids: readonly string[]): Promise<void>
  destroy(): Promise<void>
}

export const IDB_NAME = "draft-zero-store"
// 2: added the workspace store. A bump discards nothing that matters — every
// store here is a cache of server truth.
export const IDB_SCHEMA_VERSION = 2

const WORKSPACE_STORE = "workspace"
const META_STORE = "meta"
const META_KEY = "meta"

interface MetaRecord {
  id: typeof META_KEY
  schemaVersion: number
  savedAt: number
  stamp: number
}

const ALL_ENTITIES: EntityKind[] = [
  "story",
  "story-entry",
  "story-image",
  "lorebook-entry",
  "story-recap",
  "model-profile",
  "app-settings",
  "composer-draft",
]

class IdbPersistence implements StorePersistence {
  constructor(private db: IDBDatabase) {}

  async load(entity: EntityKind): Promise<PersistedRow[]> {
    try {
      return await new Promise<PersistedRow[]>((resolve, reject) => {
        const tx = this.db.transaction(entity, "readonly")
        const req = tx.objectStore(entity).getAll()
        req.onsuccess = () => resolve(req.result as PersistedRow[])
        req.onerror = () => reject(req.error)
      })
    } catch {
      return []
    }
  }

  async replaceAll(
    entity: EntityKind,
    rows: PersistedRow[],
    stamp: number
  ): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = this.db.transaction([entity, META_STORE], "readwrite")
        const metaStore = tx.objectStore(META_STORE)
        const entityStore = tx.objectStore(entity)

        const metaReq = metaStore.get(META_KEY)
        metaReq.onsuccess = () => {
          const existing = metaReq.result as MetaRecord | undefined
          // A hidden, socketless, stale tab's pagehide flush must not clobber
          // the cache a live tab already wrote with a newer stamp.
          if (typeof existing?.stamp === "number" && existing.stamp > stamp) {
            tx.abort()
            return
          }
          entityStore.clear()
          for (const row of rows) {
            entityStore.put(row)
          }
          const meta: MetaRecord = {
            id: META_KEY,
            schemaVersion: IDB_SCHEMA_VERSION,
            savedAt: Date.now(),
            stamp,
          }
          metaStore.put(meta)
        }
        metaReq.onerror = () => reject(metaReq.error)

        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => resolve()
      })
    } catch {
      // resolved void — persistence is a cache, a failed write costs one fetch
    }
  }

  async loadWorkspaces(): Promise<PersistedWorkspace[]> {
    try {
      return await new Promise<PersistedWorkspace[]>((resolve, reject) => {
        const tx = this.db.transaction(WORKSPACE_STORE, "readonly")
        const req = tx.objectStore(WORKSPACE_STORE).getAll()
        req.onsuccess = () => resolve(req.result as PersistedWorkspace[])
        req.onerror = () => reject(req.error)
      })
    } catch {
      return []
    }
  }

  async putWorkspace(entry: PersistedWorkspace): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = this.db.transaction(WORKSPACE_STORE, "readwrite")
        tx.objectStore(WORKSPACE_STORE).put(entry)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => resolve()
      })
    } catch {
      // a cache: a failed write costs one fetch
    }
  }

  async keepWorkspaces(ids: readonly string[]): Promise<void> {
    const keep = new Set(ids)
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = this.db.transaction(WORKSPACE_STORE, "readwrite")
        const store = tx.objectStore(WORKSPACE_STORE)
        const req = store.getAllKeys()
        req.onsuccess = () => {
          for (const key of req.result) {
            if (!keep.has(String(key))) store.delete(key)
          }
        }
        req.onerror = () => reject(req.error)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => resolve()
      })
    } catch {
      // best-effort
    }
  }

  async destroy(): Promise<void> {
    try {
      this.db.close()
    } catch {
      // best-effort
    }
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_SCHEMA_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const entity of ALL_ENTITIES) {
        if (!db.objectStoreNames.contains(entity)) {
          db.createObjectStore(entity, { keyPath: "id" })
        }
      }
      if (!db.objectStoreNames.contains(WORKSPACE_STORE)) {
        db.createObjectStore(WORKSPACE_STORE, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "id" })
      }
    }
    req.onsuccess = () => {
      const db = req.result
      if (db.version > IDB_SCHEMA_VERSION) {
        db.close()
        reject(
          new Error(
            "draft-zero-store: existing db version is newer than schema"
          )
        )
        return
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
  })
}

async function deleteDb(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(IDB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

export async function openIdbPersistence(): Promise<StorePersistence | null> {
  try {
    // iOS private mode throws on ACCESS, not just on open — guard the typeof
    // check itself, not only the open() call that follows it.
    if (typeof indexedDB === "undefined") return null
  } catch {
    return null
  }

  try {
    const db = await openDb()
    return new IdbPersistence(db)
  } catch {
    try {
      await deleteDb()
      const db = await openDb()
      return new IdbPersistence(db)
    } catch {
      return null
    }
  }
}

/** In-memory fallback for environments without IndexedDB (bun test, SSR). */
export class InMemoryPersistence implements StorePersistence {
  private tables = new Map<EntityKind, Map<string, PersistedRow>>()
  private workspaces = new Map<string, PersistedWorkspace>()
  private stamp = -Infinity

  async load(entity: EntityKind): Promise<PersistedRow[]> {
    const table = this.tables.get(entity)
    return table ? [...table.values()] : []
  }

  async replaceAll(
    entity: EntityKind,
    rows: PersistedRow[],
    stamp: number
  ): Promise<void> {
    if (stamp < this.stamp) return
    this.stamp = stamp
    const table = new Map<string, PersistedRow>()
    for (const row of rows) {
      table.set(row.id, row)
    }
    this.tables.set(entity, table)
  }

  async loadWorkspaces(): Promise<PersistedWorkspace[]> {
    return [...this.workspaces.values()]
  }

  async putWorkspace(entry: PersistedWorkspace): Promise<void> {
    this.workspaces.set(entry.id, entry)
  }

  async keepWorkspaces(ids: readonly string[]): Promise<void> {
    const keep = new Set(ids)
    for (const id of [...this.workspaces.keys()]) {
      if (!keep.has(id)) this.workspaces.delete(id)
    }
  }

  async destroy(): Promise<void> {
    this.tables.clear()
    this.workspaces.clear()
  }
}

/** One table's rows, as the persister asks for them at flush time. */
export interface PersistedTable {
  entity: EntityKind
  getRows: () => PersistedRow[]
}

export function createPersister(
  p: StorePersistence,
  tables: readonly PersistedTable[],
  getStamp: () => number,
  opts?: { delayMs?: number }
): { onStoreChanged(): void; flush(): void; dispose(): void } {
  const delayMs = opts?.delayMs ?? 500
  let timer: ReturnType<typeof setTimeout> | null = null
  let chain: Promise<void> = Promise.resolve()
  let disposed = false

  function writeNow(): void {
    // Chain onto the previous write so overlapping calls serialize instead of
    // racing two transactions against the same store. Rows are read inside the
    // chain, not before it, so a queued write persists the state at ITS turn
    // rather than the state when it was scheduled.
    const stamp = getStamp()
    for (const table of tables) {
      chain = chain
        .then(() => p.replaceAll(table.entity, table.getRows(), stamp))
        .catch(() => {
          // rejections swallowed — persistence is a cache
        })
    }
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  return {
    onStoreChanged() {
      if (disposed) return
      clearTimer()
      timer = setTimeout(() => {
        timer = null
        writeNow()
      }, delayMs)
    },
    flush() {
      if (disposed) return
      clearTimer()
      writeNow()
    },
    dispose() {
      disposed = true
      clearTimer()
    },
  }
}
