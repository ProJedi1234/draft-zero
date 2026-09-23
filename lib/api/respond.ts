// lib/api/respond.ts — The seam between an HTTP request and a service. Every
// route under app/api that fronts a service reads and answers through here, so
// the wire shape is decided once.
import "server-only"

import type { z } from "zod"

import { ORIGIN_HEADER, type ServiceContext } from "@/lib/services/context"
import {
  fail,
  type ServiceErrorCode,
  type ServiceFailure,
  type ServiceResult,
} from "@/lib/services/result"

const STATUS: Record<ServiceErrorCode, number> = {
  invalid: 400,
  not_found: 404,
  conflict: 409,
  failed: 500,
}

export function contextOf(request: Request): ServiceContext {
  return { origin: request.headers.get(ORIGIN_HEADER) || null }
}

/**
 * The body as an untyped JSON object. The service parses it against its own
 * schema, so the route does not validate twice. Anything but an object is
 * refused here: routes spread the body into the input, and a spread array or
 * string would read as a request with no fields at all.
 */
export async function readJson(
  request: Request
): Promise<ServiceResult<Record<string, unknown>>> {
  let data: unknown
  try {
    data = await request.json()
  } catch {
    return fail("invalid", "The request body must be JSON.")
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return fail("invalid", "The request body must be a JSON object.")
  }
  return { ok: true, data: data as Record<string, unknown> }
}

/**
 * Send a service result as the body, success or failure, so a client handles
 * one union everywhere. `output` is checked at compile time only: the service
 * built the data from typed rows, and parsing it again would turn a legacy row
 * into a 500 instead of a readable response.
 */
export function respond<S extends z.ZodType>(
  _output: S,
  result: ServiceResult<z.input<S>>
): Response {
  return json(result, result.ok ? 200 : STATUS[result.code])
}

/** A failure the route itself decided, before any service ran. */
export function refuse(failure: ServiceFailure): Response {
  return json(failure, STATUS[failure.code])
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}
