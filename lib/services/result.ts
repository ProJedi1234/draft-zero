// lib/services/result.ts — What every service returns, and how input becomes
// trusted. Isomorphic and free of server imports, so a shared contract package
// can lift it out with the schemas.
import type { z } from "zod"

/**
 * Why a call failed, in a form a client can branch on. The PWA reads only
 * `error`; a route maps `code` to a status (see lib/api/respond.ts).
 *
 * - `invalid`: the input failed its schema or a rule the schema cannot state
 * - `not_found`: the row the input names does not exist
 * - `conflict`: the call is well-formed but the story's state refuses it now,
 *   such as a write while a generation holds the story
 * - `failed`: the server could not finish a valid call (provider, storage)
 */
export type ServiceErrorCode = "invalid" | "not_found" | "conflict" | "failed"

export type ServiceFailure = {
  ok: false
  code: ServiceErrorCode
  error: string
}

/**
 * A superset of ActionResult: the failure arm adds `code`, so an action can
 * return a service's result unchanged.
 */
export type ServiceResult<T = null> = { ok: true; data: T } | ServiceFailure

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data }
}

export function fail(code: ServiceErrorCode, error: string): ServiceFailure {
  return { ok: false, code, error }
}

/**
 * Parse untrusted input. The failure carries the FIRST issue's message, which
 * is why schemas state their rules in the order the old actions checked them:
 * a writer sees the same sentence they always did.
 */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown
): { ok: true; data: z.output<S> } | ServiceFailure {
  const parsed = schema.safeParse(input)
  if (parsed.success) return ok(parsed.data)
  return fail("invalid", parsed.error.issues[0]?.message ?? "Invalid input.")
}
