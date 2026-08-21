// tests/run-status.test.ts — The specification for the library's status marks
// (hooks/use-run-status.ts).
//
// The marks answer one question: which stories finished something while the
// writer was reading a different one. Everything hard about that is in
// `reconcile`, which is pure so it can be pinned down here rather than
// inferred from a hook's render order.

import { describe, expect, test } from "bun:test"

import { markFor, reconcile, type UnseenEnding } from "@/hooks/use-run-status"

const NONE: Record<string, UnseenEnding> = {}

describe("markFor", () => {
  test("only a provider error is a failure", () => {
    expect(markFor("error")).toBe("failed")
    expect(markFor("ok")).toBe("done")
    // A Stop is the writer's own decision and persists whatever prose it had.
    // Marking it would train them to ignore the mark.
    expect(markFor("aborted")).toBe("done")
  })
})

describe("reconcile", () => {
  test("a run that vanished without its ending being heard counts as landed", () => {
    // The gap is real: a hidden tab holds no socket, so switching browser tabs
    // across a run's finish loses run-ended for good.
    expect(reconcile(NONE, ["a"], [], null)).toEqual({ a: "done" })
  })

  test("a run still in flight is not marked", () => {
    expect(reconcile(NONE, ["a"], ["a"], null)).toBe(NONE)
  })

  test("the story being read never holds a mark", () => {
    // Two ways in: it was already marked, and it finished while open.
    expect(reconcile({ a: "done" }, [], [], "a")).toEqual({})
    expect(reconcile(NONE, ["a"], [], "a")).toBe(NONE)
  })

  test("a heard ending outranks the vanished-run guess", () => {
    // run-ended already said this one failed; the fallback must not overwrite
    // that with a cheerful "done".
    expect(reconcile({ a: "failed" }, ["a"], [], null)).toEqual({ a: "failed" })
  })

  test("marks for other stories survive opening one", () => {
    expect(reconcile({ a: "done", b: "failed" }, [], [], "a")).toEqual({
      b: "failed",
    })
  })

  test("returns the same object when nothing moved, so the caller can skip a render", () => {
    const unseen = { a: "done" as const }
    expect(reconcile(unseen, ["b"], ["b"], null)).toBe(unseen)
    expect(reconcile(unseen, [], [], "b")).toBe(unseen)
  })

  test("several runs finishing in the same payload are all marked", () => {
    expect(reconcile(NONE, ["a", "b", "c"], ["b"], null)).toEqual({
      a: "done",
      c: "done",
    })
  })
})
