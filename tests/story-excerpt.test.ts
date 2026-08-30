import { describe, expect, test } from "bun:test"

import { EXCERPT_CHARS, toExcerpt } from "@/lib/db/mappers"

/**
 * The library's excerpt trim. Postgres does the cutting (`right()`), so what is
 * tested here is the half that decides whether the result reads as a quotation
 * or as a rendering bug.
 */
describe("toExcerpt", () => {
  test("a passage shorter than the budget is quoted whole", () => {
    expect(toExcerpt("The lamps went out.", 19)).toBe("The lamps went out.")
  })

  test("no ellipsis when the passage exactly fills the budget", () => {
    const text = "x".repeat(EXCERPT_CHARS)
    expect(toExcerpt(text, EXCERPT_CHARS)).toBe(text)
  })

  test("a cut passage drops its partial first word and takes an ellipsis", () => {
    // What `right()` hands back when the cut lands mid-word.
    expect(toExcerpt("ing the lamps twice", EXCERPT_CHARS + 40)).toBe(
      "…the lamps twice"
    )
  })

  test("a cut that lands on a space keeps every whole word", () => {
    expect(toExcerpt(" the lamps twice", EXCERPT_CHARS + 40)).toBe(
      "…the lamps twice"
    )
  })

  test("one unbroken word is kept rather than emptied", () => {
    expect(toExcerpt("Rappaccinis", EXCERPT_CHARS + 5)).toBe("…Rappaccinis")
  })

  test("a blank passage stays blank, so no row quotes an empty string", () => {
    expect(toExcerpt("   \n ", 5)).toBe("")
  })
})
