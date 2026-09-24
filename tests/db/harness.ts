// tests/db/harness.ts — Runs services against a real, throwaway Postgres.
//
// The mocked specs cannot see transaction boundaries or what the op journal
// actually replays, so these suites exist for the services where that is the
// risk. They are *.pg.ts, which `bun test` does not collect: every other spec
// doubles "@/lib/db/client" process-wide, so these need a process of their own.
//
//   DRAFT_ZERO_TEST_DATABASE_URL=postgres://…/draft_zero_test bun run test:db
//
// The suites truncate every table, so the harness refuses a database whose
// name does not end in _test, and never reads DATABASE_URL.
import { mock } from "bun:test"

import { sql } from "drizzle-orm"
import { migrate } from "drizzle-orm/node-postgres/migrator"

const url = process.env.DRAFT_ZERO_TEST_DATABASE_URL
if (!url) {
  throw new Error(
    "DRAFT_ZERO_TEST_DATABASE_URL is not set. Point it at a throwaway database whose name ends in _test."
  )
}
const name = new URL(url).pathname.replace(/^\//, "")
if (!name.endsWith("_test")) {
  throw new Error(
    `Refusing to run against "${name}": these suites truncate every table, so the database name must end in _test.`
  )
}
process.env.DATABASE_URL = url
// Keep the model catalog off the network: with no key it answers from the
// built-in mock list.
delete process.env.OPENROUTER_API_KEY

mock.module("server-only", () => ({}))
mock.module("next/cache", () => ({ revalidatePath: () => {} }))

const { getDb, closeDb } = await import("@/lib/db/client")

export { closeDb, getDb }

/** Apply every migration once per process. */
export async function migrateOnce(): Promise<void> {
  await migrate(await getDb(), { migrationsFolder: "drizzle" })
}

/** Empty every table the app owns, so each test starts from nothing. */
export async function truncateAll(): Promise<void> {
  const db = await getDb()
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`
  )
  const tables = rows.rows.map((row) => `"${row.tablename}"`)
  if (tables.length === 0) return
  await db.execute(
    sql.raw(`truncate table ${tables.join(", ")} restart identity cascade`)
  )
}
