// tests/history-ops.test.ts — The specification for lib/history/ops.ts, the
// pure half of undo/redo. Everything here is a table of [payload, expected
// plan] or of [input, expected result]; the rows marked ACCEPTED pin behaviour
// that looks like an omission but is a deliberate choice, so that a later
// reader can tell a limit from a regression before "fixing" it.
//
// The suite leans hardest on two things the rest of the feature cannot check
// for itself:
//
// 1. Round-tripping. Undo then redo must land on exactly the state we started
//    from, for every op kind. That is asserted against a tiny in-memory row
//    store rather than by eyeballing the two plans, because it is the property
//    the writer actually experiences and it survives a rewrite of the plans.
// 2. Ordering. Wherever `is_active` moves between two takes of one slot, the
//    deactivation must come first, or the partial unique index on
//    (story_id, position) sees two active rows at one position and rejects the
//    statement. That ordering is invisible in production until it fails on a
//    real database, so it is pinned here by index.

import { describe, expect, test } from "bun:test"
import {
  coalesceEdit,
  parsePayload,
  redoPlan,
  summarize,
  undoPlan,
  type EditPayload,
  type EntryMutation,
  type EntryProse,
  type OpPayload,
} from "@/lib/history/ops"

const BEFORE: EntryProse = {
  text: "The door was locked.",
  actionKind: null,
  inputText: null,
}

const AFTER: EntryProse = {
  text: "The door was bolted from the inside.",
  actionKind: null,
  inputText: null,
}

// One representative payload per kind, reused by every table below so that a
// kind added to OpKind without a payload here shows up as a gap in one place.
const TURN: OpPayload = {
  kind: "turn",
  userEntryId: "user-1",
  generatedEntryId: "gen-1",
}
const CONTINUE_TURN: OpPayload = {
  kind: "turn",
  userEntryId: null,
  generatedEntryId: "gen-1",
}
const ABANDONED_TURN: OpPayload = {
  kind: "turn",
  userEntryId: "user-1",
  generatedEntryId: null,
}
const EDIT: EditPayload = {
  kind: "edit",
  entryId: "entry-1",
  before: BEFORE,
  after: AFTER,
}
const DELETE: OpPayload = { kind: "delete", entryId: "entry-1" }
const RETRY: OpPayload = {
  kind: "retry",
  variantGroupId: "slot-1",
  previousEntryId: "take-1",
  newEntryId: "take-2",
}
const SWITCH: OpPayload = {
  kind: "switch-take",
  variantGroupId: "slot-1",
  fromEntryId: "take-2",
  toEntryId: "take-1",
}
const REWIND: OpPayload = {
  kind: "rewind",
  entryIds: ["tail-1", "tail-2", "tail-3"],
}
// A rewind past a single passage. Its own row because the summary pluralises
// and because one-passage is the cut a writer makes most often.
const REWIND_ONE: OpPayload = { kind: "rewind", entryIds: ["tail-1"] }

type PlanCase = readonly [
  name: string,
  payload: OpPayload,
  expected: EntryMutation[],
]

const UNDO_CASES: readonly PlanCase[] = [
  [
    "turn — both halves are soft-deleted together, because to the writer the " +
      "Send and the passage it produced were one move",
    TURN,
    [
      { type: "set-deleted", entryId: "user-1", deleted: true },
      { type: "set-deleted", entryId: "gen-1", deleted: true },
    ],
  ],
  // A bare Continue has no user half and a generation that died mid-stream has
  // no generated half. Both are ordinary outcomes, so the null is skipped
  // rather than treated as a corrupt op.
  [
    "turn — a Continue undoes only the generated half",
    CONTINUE_TURN,
    [{ type: "set-deleted", entryId: "gen-1", deleted: true }],
  ],
  [
    "turn — an abandoned generation still undoes its user half",
    ABANDONED_TURN,
    [{ type: "set-deleted", entryId: "user-1", deleted: true }],
  ],
  [
    "edit — restores the prose as it read before",
    EDIT,
    [{ type: "set-prose", entryId: "entry-1", prose: BEFORE }],
  ],
  [
    "delete — un-deletes; the row was never gone",
    DELETE,
    [{ type: "set-deleted", entryId: "entry-1", deleted: false }],
  ],
  // Undoing a retry does not discard the retried take: it goes inactive and
  // stays reachable through the take switcher.
  [
    "retry — the slot goes back to the take that was active before it",
    RETRY,
    [
      { type: "set-active", entryId: "take-2", active: false },
      { type: "set-active", entryId: "take-1", active: true },
    ],
  ],
  [
    "switch-take — steps back to the take the writer came from",
    SWITCH,
    [
      { type: "set-active", entryId: "take-1", active: false },
      { type: "set-active", entryId: "take-2", active: true },
    ],
  ],
  // The whole tail in one plan, which is the property that makes a rewind one
  // ⌘Z rather than one per passage it took.
  [
    "rewind — every cut passage comes back at once",
    REWIND,
    [
      { type: "set-deleted", entryId: "tail-1", deleted: false },
      { type: "set-deleted", entryId: "tail-2", deleted: false },
      { type: "set-deleted", entryId: "tail-3", deleted: false },
    ],
  ],
]

const REDO_CASES: readonly PlanCase[] = [
  [
    "turn — both halves come back",
    TURN,
    [
      { type: "set-deleted", entryId: "user-1", deleted: false },
      { type: "set-deleted", entryId: "gen-1", deleted: false },
    ],
  ],
  [
    "turn — a Continue restores only the generated half",
    CONTINUE_TURN,
    [{ type: "set-deleted", entryId: "gen-1", deleted: false }],
  ],
  [
    "turn — an abandoned generation restores only its user half",
    ABANDONED_TURN,
    [{ type: "set-deleted", entryId: "user-1", deleted: false }],
  ],
  [
    "edit — reapplies the prose as edited",
    EDIT,
    [{ type: "set-prose", entryId: "entry-1", prose: AFTER }],
  ],
  [
    "delete — soft-deletes again",
    DELETE,
    [{ type: "set-deleted", entryId: "entry-1", deleted: true }],
  ],
  [
    "retry — the new take becomes active again",
    RETRY,
    [
      { type: "set-active", entryId: "take-1", active: false },
      { type: "set-active", entryId: "take-2", active: true },
    ],
  ],
  [
    "switch-take — lands back on the take that was switched to",
    SWITCH,
    [
      { type: "set-active", entryId: "take-2", active: false },
      { type: "set-active", entryId: "take-1", active: true },
    ],
  ],
  [
    "rewind — cuts the same tail again, by id and not by position",
    REWIND,
    [
      { type: "set-deleted", entryId: "tail-1", deleted: true },
      { type: "set-deleted", entryId: "tail-2", deleted: true },
      { type: "set-deleted", entryId: "tail-3", deleted: true },
    ],
  ],
]

describe("undoPlan", () => {
  for (const [name, payload, expected] of UNDO_CASES) {
    test(name, () => {
      expect(undoPlan(payload)).toEqual(expected)
    })
  }
})

describe("redoPlan", () => {
  for (const [name, payload, expected] of REDO_CASES) {
    test(name, () => {
      expect(redoPlan(payload)).toEqual(expected)
    })
  }
})

// The ordering rule stated at the top of this file, asserted on its own so a
// failure names the invariant rather than a whole expected array. Any op that
// moves the active flag between two rows has to appear in this table.
describe("plans deactivate before they activate", () => {
  const SWAPPING: readonly (readonly [string, OpPayload])[] = [
    ["retry", RETRY],
    ["switch-take", SWITCH],
  ]

  for (const [name, payload] of SWAPPING) {
    for (const [direction, plan] of [
      ["undoPlan", undoPlan(payload)],
      ["redoPlan", redoPlan(payload)],
    ] as const) {
      test(`${direction}(${name})`, () => {
        expect(plan).toHaveLength(2)
        expect(plan[0]).toMatchObject({ type: "set-active", active: false })
        expect(plan[1]).toMatchObject({ type: "set-active", active: true })
      })
    }
  }
})

// A stand-in for the rows lib/db/journal.ts would write to, small enough to
// hold the whole of what a mutation can change. Applying a plan to it is the
// only way to state the round-trip property without asserting on SQL.
interface Row {
  deleted: boolean
  active: boolean
  prose: EntryProse
}

type Store = Record<string, Row>

function applyPlan(store: Store, plan: EntryMutation[]): Store {
  const next: Store = structuredClone(store)
  for (const mutation of plan) {
    const row = next[mutation.entryId]
    if (!row)
      throw new Error(`plan touched an unknown row: ${mutation.entryId}`)
    if (mutation.type === "set-deleted") row.deleted = mutation.deleted
    else if (mutation.type === "set-active") row.active = mutation.active
    else row.prose = mutation.prose
  }
  return next
}

function row(overrides: Partial<Row> = {}): Row {
  return { deleted: false, active: true, prose: AFTER, ...overrides }
}

// Each case is the store as it stands with the op *applied* — that is the state
// undo is invoked from, and the state redo has to get back to.
type RoundTripCase = readonly [name: string, payload: OpPayload, applied: Store]

const ROUND_TRIPS: readonly RoundTripCase[] = [
  ["turn", TURN, { "user-1": row(), "gen-1": row() }],
  ["turn — continue", CONTINUE_TURN, { "gen-1": row() }],
  ["turn — abandoned generation", ABANDONED_TURN, { "user-1": row() }],
  ["edit", EDIT, { "entry-1": row({ prose: AFTER }) }],
  ["delete", DELETE, { "entry-1": row({ deleted: true }) }],
  [
    "retry",
    RETRY,
    { "take-1": row({ active: false }), "take-2": row({ active: true }) },
  ],
  [
    "switch-take",
    SWITCH,
    { "take-2": row({ active: false }), "take-1": row({ active: true }) },
  ],
  [
    "rewind",
    REWIND,
    {
      "tail-1": row({ deleted: true }),
      "tail-2": row({ deleted: true }),
      "tail-3": row({ deleted: true }),
    },
  ],
]

describe("undo then redo is the identity", () => {
  for (const [name, payload, applied] of ROUND_TRIPS) {
    test(name, () => {
      const undone = applyPlan(applied, undoPlan(payload))
      // The undo has to actually change something, or the round-trip below
      // would pass for a plan that does nothing at all.
      expect(undone).not.toEqual(applied)
      expect(applyPlan(undone, redoPlan(payload))).toEqual(applied)
    })
  }

  // Redo/undo the other way round matters too: after a redo the writer can
  // press ⌘Z again, and the journal replays the same pair of plans.
  test("and so is redo then undo, from the undone state", () => {
    for (const [, payload, applied] of ROUND_TRIPS) {
      const undone = applyPlan(applied, undoPlan(payload))
      const redone = applyPlan(undone, redoPlan(payload))
      expect(applyPlan(redone, undoPlan(payload))).toEqual(undone)
    }
  })
})

describe("coalesceEdit", () => {
  const FIRST: EditPayload = {
    kind: "edit",
    entryId: "entry-1",
    before: BEFORE,
    after: { ...AFTER, text: "The door was bolted." },
  }
  const SECOND: EditPayload = {
    kind: "edit",
    entryId: "entry-1",
    before: { ...AFTER, text: "The door was bolted." },
    after: AFTER,
  }

  test("merges two edits of one entry, keeping the earliest before", () => {
    const merged = coalesceEdit(FIRST, SECOND)
    // The merged op reads as "everything the writer did in this sitting":
    // the after of the newest edit, the before of the oldest, so one ⌘Z
    // returns to how the block read before the fiddling started.
    expect(merged).toEqual({
      kind: "edit",
      entryId: "entry-1",
      before: BEFORE,
      after: AFTER,
    })
  })

  test("refuses an edit of a different entry", () => {
    expect(coalesceEdit(FIRST, { ...SECOND, entryId: "entry-2" })).toBeNull()
  })

  // Anything other than an edit between the two is a boundary the writer would
  // expect ⌘Z to stop at, so none of these absorb the new edit.
  const NON_EDIT_PREVIOUS: readonly (readonly [string, OpPayload])[] = [
    ["turn", TURN],
    ["delete", DELETE],
    ["retry", RETRY],
    ["switch-take", SWITCH],
    ["rewind", REWIND],
  ]

  for (const [name, previous] of NON_EDIT_PREVIOUS) {
    test(`refuses a previous ${name} op`, () => {
      expect(coalesceEdit(previous, SECOND)).toBeNull()
    })
  }

  test("does not mutate either input", () => {
    const previous = structuredClone(FIRST)
    const next = structuredClone(SECOND)
    coalesceEdit(previous, next)
    expect(previous).toEqual(FIRST)
    expect(next).toEqual(SECOND)
  })
})

describe("summarize", () => {
  const CASES: readonly (readonly [OpPayload, string])[] = [
    // A turn with a user half was a Say or a Do; without one it was a bare
    // Continue, and calling that "Your turn" would be a small lie.
    [TURN, "Your turn"],
    [CONTINUE_TURN, "Continue"],
    [ABANDONED_TURN, "Your turn"],
    [EDIT, "Edit"],
    [DELETE, "Delete passage"],
    [RETRY, "Retry"],
    [SWITCH, "Switch take"],
    // The count is in the phrase because it is the one op whose size the
    // manuscript no longer shows — the passages it took are off the page.
    [REWIND, "Rewind 3 passages"],
    [REWIND_ONE, "Rewind 1 passage"],
  ]

  for (const [payload, expected] of CASES) {
    test(`${payload.kind} → ${expected}`, () => {
      expect(summarize(payload)).toBe(expected)
    })
  }
})

describe("parsePayload", () => {
  test("round-trips every op kind through JSON", () => {
    for (const payload of [TURN, EDIT, DELETE, RETRY, SWITCH, REWIND]) {
      expect(parsePayload(JSON.stringify(payload))).toEqual(payload)
    }
  })

  // A corrupt op must degrade to "undo is unavailable", never throw out of a
  // server action and take the story page with it — so every one of these
  // returns null rather than raising.
  const REJECTED: readonly (readonly [name: string, json: string])[] = [
    ["empty string", ""],
    ["truncated json", '{"kind":"edit"'],
    ["not json at all", "undefined"],
    ["json null", "null"],
    ["a bare string", '"turn"'],
    ["a number", "42"],
    ["an array", '[{"kind":"turn"}]'],
    ["an object with no kind", '{"entryId":"entry-1"}'],
    ["a kind that is not a string", '{"kind":7}'],
    ["an unknown kind, e.g. from a newer build", '{"kind":"branch"}'],
    ["a near-miss kind", '{"kind":"switch_take"}'],
  ]

  for (const [name, json] of REJECTED) {
    test(`returns null for ${name}`, () => {
      expect(parsePayload(json)).toBeNull()
    })
  }

  // ACCEPTED: only the discriminant is validated, so a payload with the right
  // kind and missing fields parses. These rows are written by this same module
  // and never by a user, so the realistic failures are the ones above; a
  // per-payload validator would be ceremony guarding a case that cannot arise.
  // If that ever stops being true, these are the rows to change.
  test("ACCEPTED: does not validate a payload beyond its kind", () => {
    expect(parsePayload('{"kind":"edit"}')).toEqual({
      kind: "edit",
    } as unknown as OpPayload)
    expect(parsePayload('{"kind":"retry","previousEntryId":null}')).toEqual({
      kind: "retry",
      previousEntryId: null,
    } as unknown as OpPayload)
  })
})
