// tests/story-recap-resolution.test.ts — Which stored version of a story's
// summary is in force.
//
// This is one SELECT, and every interesting property of the feature rests on
// its WHERE clause. Rewinding a story is free — no model call, nothing
// journalled — purely because a version whose through-passage has been
// soft-deleted stops being eligible, so the previous version takes over on its
// own. Undoing the rewind restores those passages and the newer version comes
// straight back.
//
// Drop the liveness filter and all of that inverts: a rewound branch's summary
// returns to describe a future that was un-happened, the model keeps steering
// toward it, and nothing anywhere reports a fault. That is the regression this
// file exists to catch, so it asserts the rendered statement rather than a
// return value — there is no DB harness here (see the header of
// tests/generation-calls.test.ts) and the shape is the whole point.

import { describe, expect, mock, test } from "bun:test"
import { drizzle } from "drizzle-orm/node-postgres"

mock.module("server-only", () => ({}))

const { storyRecapQuery } = await import("@/lib/db/queries")

/** No driver, no connection — enough to build a statement and render it. */
const sql = storyRecapQuery(drizzle.mock(), "story-1").toSQL().sql

describe("resolveStoryRecap's statement", () => {
  test("joins the passage each version was written through", () => {
    expect(sql).toContain('"story_recaps"')
    expect(sql).toContain('inner join "story_entries"')
    expect(sql).toContain(
      '"story_entries"."id" = "story_recaps"."through_entry_id"'
    )
  })

  test("excludes versions whose passage was rewound away", () => {
    // Soft-deleted: what a rewind and a plain delete both leave behind.
    expect(sql).toContain('"story_entries"."deleted_at" is null')
  })

  test("excludes versions whose passage is no longer the active take", () => {
    // A take switch deactivates rather than deletes, and a summary written
    // against the take you stepped away from is just as stale.
    expect(sql).toMatch(/"story_entries"\."is_active" = \$\d/)
  })

  test("is scoped to one story", () => {
    expect(sql).toMatch(/"story_recaps"\."story_id" = \$\d/)
  })

  test("orders by coverage first, recency second, and takes one", () => {
    // Coverage first is insurance rather than logic while the summary only
    // moves forward — but it is the half that stays right if a narrower
    // version is ever written later, where recency alone would prefer it.
    expect(sql).toMatch(
      /order by "story_recaps"\."through_position" desc, "story_recaps"\."created_at" desc/
    )
    expect(sql).toContain("limit")
  })
})
