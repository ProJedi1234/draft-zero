// lib/db/client.ts — Lazy, memoized Postgres connection pool.
//
// IMPORTANT: this module has NO side effects at import time. `next build`
// imports every route module, and the database is not necessarily reachable
// during a build. Nothing connects until the first `await getDb()`.
//
// Migrations are NOT applied here — unlike the SQLite setup this replaced.
// Against a shared server, two app instances (or the app and `db:seed`) racing
// `migrate()` corrupt the migration bookkeeping. Schema changes are an explicit
// step: `bun run db:migrate`.

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import * as schema from "./schema"

export type DrizzleDb = NodePgDatabase<typeof schema>

/**
 * Next's dev server re-evaluates modules on every HMR pass. Without stashing
 * the pool globally, each reload leaks a pool and its sockets until Postgres
 * refuses new connections.
 */
const globalForDb = globalThis as unknown as {
  __draftZeroPool?: Pool
  __draftZeroDb?: DrizzleDb
}

function getPool(): Pool {
  if (!globalForDb.__draftZeroPool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env.local (see README)."
      )
    }
    globalForDb.__draftZeroPool = new Pool({ connectionString })
  }
  return globalForDb.__draftZeroPool
}

/**
 * Memoized lazy singleton. Async purely to keep the call signature every
 * caller already uses; the pool itself connects lazily per query.
 */
export function getDb(): Promise<DrizzleDb> {
  if (!globalForDb.__draftZeroDb) {
    globalForDb.__draftZeroDb = drizzle(getPool(), { schema })
  }
  return Promise.resolve(globalForDb.__draftZeroDb)
}

/** Closes the pool so short-lived scripts (seed, migrate) can exit. */
export async function closeDb(): Promise<void> {
  const pool = globalForDb.__draftZeroPool
  if (!pool) return
  globalForDb.__draftZeroPool = undefined
  globalForDb.__draftZeroDb = undefined
  await pool.end()
}
