// lib/db/client.ts — Lazy, memoized SQLite (libsql) connection.
//
// IMPORTANT: this module has NO side effects at import time. `next build`
// imports every route module, and a fresh checkout has no `data/` directory —
// opening the database eagerly would create files (or fail) during the build.
// The first `await getDb()` creates `data/`, opens the file, and applies the
// committed migrations in `drizzle/`.

import fs from "node:fs"

import { createClient } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"
import { migrate } from "drizzle-orm/libsql/migrator"

import * as schema from "./schema"

const DB_DIR = "data"
const DB_URL = "file:data/draft-zero.db"

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>

let dbPromise: Promise<DrizzleDb> | null = null

async function initDb(): Promise<DrizzleDb> {
  fs.mkdirSync(DB_DIR, { recursive: true })
  const client = createClient({ url: DB_URL })
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: "drizzle" })
  return db
}

/** Memoized lazy singleton — concurrent callers share one initialization. */
export function getDb(): Promise<DrizzleDb> {
  if (!dbPromise) {
    dbPromise = initDb().catch((error) => {
      // Never memoize a failed init: let the next caller retry.
      dbPromise = null
      throw error
    })
  }
  return dbPromise
}
