// lib/mcp/helpers.ts — the shared vocabulary every MCP tool speaks.
//
// The efficiency rules in MCP_PLAN.md are only rules if they are cheaper to
// follow than to break, so each one has a function here: `structured` makes
// "summary line + structuredContent" the shortest way to return anything,
// `snippet` makes truncation the default, `paginate` and `resolveRange` make
// the tail the default read. A tool that reaches past these is usually about
// to echo prose back at the model.
import type {
  CallToolResult,
  McpServer,
  ServerContext,
} from "@modelcontextprotocol/server"

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Per-request wiring handed to every tool module. It exists so a tool that
 * needs a process-wide singleton (the multi-round-trip state codec) does not
 * reach for a module import of `server.ts` and close an import cycle.
 */
export interface ToolDeps {
  /**
   * Seals the opaque `requestState` a multi-round-trip tool hands the client
   * between rounds. Only `delete_story` uses it; the payload is signed, NOT
   * encrypted, so it carries intent, never secrets.
   *
   * `ctx` is required because the codec binds state to the originating method.
   * That binding cannot separate one tool from another — every tool arrives as
   * `tools/call` — so the payload names its own `tool` and the handler MUST
   * check that name before acting on echoed state.
   */
  mintRequestState: (
    payload: RequestStatePayload,
    ctx: ServerContext
  ) => Promise<string>
}

/**
 * What a paused tool remembers across an `input_required` round trip. Keep it
 * to identifiers and the operation name — the client can read it.
 */
export interface RequestStatePayload {
  tool: string
  storyId?: string
  [key: string]: unknown
}

/** Every `lib/mcp/tools/*.ts` module exports registrars of this shape. */
export type RegisterTool = (server: McpServer, deps: ToolDeps) => void

/* -------------------------------------------------------------------------- */
/* Result shaping                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The only way a tool should return success.
 *
 * `summary` is one line of prose for a client that renders content blocks;
 * `data` is the machine-readable answer and MUST match the tool's
 * `outputSchema`. Never put the payload in both — the summary states the
 * delta ("wrote position 214"), the structured content carries the facts.
 */
export function structured<T extends Record<string, unknown>>(
  summary: string,
  data: T
): CallToolResult {
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: data,
  }
}

/**
 * A failure the model can act on: wrong id, empty range, name that matches
 * nothing. It comes back as a normal result with `isError`, so the model reads
 * the reason and corrects itself instead of the client surfacing a transport
 * error. Reserve thrown errors for conditions the model cannot fix.
 */
export function failed(reason: string): CallToolResult {
  return { content: [{ type: "text", text: reason }], isError: true }
}

/**
 * A condition the model CAN correct; `runTool` turns it into `failed()`.
 *
 * There is deliberately no sibling class for a defect the model cannot fix:
 * `runTool` treats every OTHER throw as exactly that, so a broken query or a
 * bad import needs no ceremony to be handled correctly.
 */
export class ToolInputError extends Error {}

/**
 * Wraps a handler body so every tool maps errors the same way.
 *
 * Worth knowing before deciding you don't need it: `registerTool` already
 * catches everything a handler throws and returns `{ isError: true }` with
 * `error.message` as the text. So a raw Postgres error does not fail the call
 * — it gets READ ALOUD to the model, connection string and all. This wrapper
 * is what keeps that from happening: a `ToolInputError` is deliberate advice
 * and passes through, anything else is logged here and answered with a line
 * that says nothing about the internals.
 */
export async function runTool(
  tool: string,
  body: () => Promise<CallToolResult>
): Promise<CallToolResult> {
  try {
    return await body()
  } catch (error) {
    if (error instanceof ToolInputError) return failed(error.message)
    console.error(`[mcp:${tool}]`, error)
    return failed(
      `${tool} failed. The server logged the reason; nothing was written.`
    )
  }
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* -------------------------------------------------------------------------- */

/** Ceiling on any `limit`, whatever a tool's own default is. */
export const MAX_PAGE_SIZE = 100

const CURSOR_PREFIX = "o"

/** Opaque forward cursor over a stable ordering: just an offset, sealed. */
export function encodeCursor(offset: number): string {
  return Buffer.from(`${CURSOR_PREFIX}:${offset}`, "utf8").toString("base64url")
}

/** Inverse of {@link encodeCursor}. A malformed cursor is the model's to fix. */
export function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined || cursor === "") return 0
  let decoded: string
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8")
  } catch {
    throw new ToolInputError("Malformed cursor; omit it to start from the top.")
  }
  const [prefix, raw] = decoded.split(":")
  const offset = Number(raw)
  if (prefix !== CURSOR_PREFIX || !Number.isSafeInteger(offset) || offset < 0) {
    throw new ToolInputError("Malformed cursor; omit it to start from the top.")
  }
  return offset
}

export interface Page<T> {
  items: T[]
  /** Absent when this page is the last one. */
  nextCursor?: string
  /** Rows before paging, so a caller can say "12 of 340" without a second call. */
  total: number
}

/**
 * Slices an already-ordered array. Fine for the row counts this app holds; a
 * tool over a table that could outgrow memory should page in SQL and build the
 * cursor with {@link encodeCursor} directly.
 */
export function paginate<T>(
  rows: readonly T[],
  cursor: string | undefined,
  limit: number
): Page<T> {
  const offset = decodeCursor(cursor)
  const size = clampLimit(limit)
  const items = rows.slice(offset, offset + size)
  const next = offset + items.length
  return {
    items,
    nextCursor: next < rows.length ? encodeCursor(next) : undefined,
    total: rows.length,
  }
}

/** Keeps a client-supplied `limit` inside `1..MAX_PAGE_SIZE`. */
export function clampLimit(limit: number, max = MAX_PAGE_SIZE): number {
  if (!Number.isFinite(limit)) return max
  return Math.max(1, Math.min(Math.trunc(limit), max))
}

/* -------------------------------------------------------------------------- */
/* Positions                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A range endpoint. `story_entries.position` and `story_images.position` draw
 * from one per-story counter, so a position names a slot in the manuscript
 * regardless of what sits in it. The two anchors save the model a round trip
 * when it does not yet know the bounds.
 */
export type PositionArg = number | "start" | "end"

export interface ResolvedRange {
  from: number
  to: number
  limit: number
  /**
   * Which end of the window `limit` rows are taken from. Positions are NOT
   * dense in live rows — a rewind soft-deletes its passages but keeps their
   * numbers, and the next write allocates past them — so `limit` can only be
   * honoured as a row count by the query, never as arithmetic on positions
   * here. The window is the whole span the caller asked for; this says which
   * end of it to fill from when the span holds more rows than `limit`.
   */
  take: "head" | "tail"
}

/**
 * Turns the `from`/`to`/`limit` triple every read accepts into a concrete
 * inclusive window.
 *
 * Defaults to the TAIL: with neither endpoint given the window is the whole
 * story taken from its end, which is what a model orienting itself almost
 * always wants. Giving only `from` reads forward from there; only `to` reads
 * backward to it.
 *
 * `limit` is a ROW COUNT, and the caller must apply it as one — `take` says
 * from which end. Deriving an endpoint from `limit` here would silently return
 * fewer rows than asked for on any story that has been rewound, and would let
 * a both-endpoints call ask the DB for the entire manuscript.
 */
export function resolveRange(
  input: { from?: PositionArg; to?: PositionArg; limit?: number },
  bounds: { first: number; last: number },
  defaultLimit: number
): ResolvedRange {
  const limit = clampLimit(input.limit ?? defaultLimit)
  if (bounds.last < bounds.first) {
    return { from: bounds.first, to: bounds.first - 1, limit, take: "head" }
  }

  const from = anchor(input.from, bounds)
  const to = anchor(input.to, bounds)

  if (from === undefined && to === undefined) {
    return { from: bounds.first, to: bounds.last, limit, take: "tail" }
  }
  // A single anchor is clamped to the far bound, so one that sits outside the
  // story — the usual case just after a rewind — would otherwise resolve to an
  // inverted window and be echoed back as a nonsensical from/to.
  if (from !== undefined && to === undefined) {
    if (from > bounds.last) {
      throw new ToolInputError(
        `Empty range: from ${from} is past the last position ${bounds.last}.`
      )
    }
    return { from, to: bounds.last, limit, take: "head" }
  }
  if (from === undefined && to !== undefined) {
    if (to < bounds.first) {
      throw new ToolInputError(
        `Empty range: to ${to} is before the first position ${bounds.first}.`
      )
    }
    return { from: bounds.first, to, limit, take: "tail" }
  }
  if (from! > to!) {
    throw new ToolInputError(
      `Empty range: from ${from} is past to ${to}. Positions ascend with the manuscript.`
    )
  }
  // Both endpoints given: the caller named the span, `limit` still caps the
  // rows. `from: 'start', to: 'end'` is a whole-manuscript request and must
  // come back one page at a time like any other.
  return { from: from!, to: to!, limit, take: "head" }
}

function anchor(
  value: PositionArg | undefined,
  bounds: { first: number; last: number }
): number | undefined {
  if (value === undefined) return undefined
  if (value === "start") return bounds.first
  if (value === "end") return bounds.last
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ToolInputError(`Position ${value} is not a whole slot number.`)
  }
  return value
}

/* -------------------------------------------------------------------------- */
/* Compact formatters                                                         */
/* -------------------------------------------------------------------------- */

/** Default snippet width — a line of context, not a paragraph. */
export const SNIPPET_CHARS = 160

/**
 * Collapses whitespace and truncates on a word boundary. Search hits and list
 * rows carry snippets, never full passages: the position is the handle the
 * model uses to fetch the rest.
 */
export function snippet(text: string, max = SNIPPET_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/** Chars kept either side of a match — a `matchSnippet` is roughly twice this. */
export const MATCH_RADIUS = 60

/**
 * A snippet windowed on WHERE the text matched, rather than truncated from the
 * start. {@link snippet} is right for a preview of a row the model already
 * asked for; this is right for a search hit, where the opening words are
 * usually not the reason the row came back.
 */
export function matchSnippet(
  text: string,
  needle: string,
  radius = MATCH_RADIUS
): string {
  const flat = text.replace(/\s+/g, " ").trim()
  const index = flat.toLowerCase().indexOf(needle.toLowerCase())
  if (index === -1) return snippet(flat, radius * 2)
  const start = Math.max(0, index - radius)
  const end = Math.min(flat.length, index + needle.length + radius)
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`
}

/** Words, for the counts list rows report. */
export function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length
}

/**
 * Joins summary fragments with a middot, dropping empty ones — the one-line
 * `content` block of a structured result.
 */
export function line(
  ...parts: (string | number | null | undefined | false)[]
): string {
  return parts
    .filter(
      (part): part is string | number =>
        part !== null && part !== undefined && part !== false && part !== ""
    )
    .join(" · ")
}

/** `1` → "1 passage", `4` → "4 passages". */
export function plural(
  count: number,
  singular: string,
  pluralForm = `${singular}s`
): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/** Date-only ISO, because a list row never needs the clock. */
export function shortDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10)
}

/** Money as the ledger reports it — four places, since calls cost fractions. */
export function usd(amount: number): string {
  return `$${amount.toFixed(4)}`
}
