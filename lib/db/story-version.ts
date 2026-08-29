// lib/db/story-version.ts — The one place stories.updated_at is minted.
//
// Every writer of that column goes through here, because it is not a timestamp
// but a version: the client store and useServerSyncedValue both arbitrate on it
// with a string comparison, and two writers landing in the same millisecond
// would otherwise mint one version for two different row states.

import { sql } from "drizzle-orm"

import { stories } from "./schema"

/**
 * Strictly-monotone version mint, computed IN the UPDATE so concurrent writers
 * cannot read-modify-write a tie: Postgres row locking serializes them and each
 * one sees the previous value. COLLATE "C" pins byte order for the text
 * comparison, and the format must byte-match Date.toISOString() exactly —
 * greatest() is comparing these as strings, not as instants.
 */
export function storyVersionBump(nowIso: string) {
  return sql<string>`greatest(
    ${nowIso} COLLATE "C",
    to_char((${stories.updatedAt}::timestamptz + interval '1 millisecond')
            at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') COLLATE "C"
  )`
}
