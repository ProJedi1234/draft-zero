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

// The transport cap server actions had in next.config.ts. Route handlers get no
// such limit from Next, so an unbounded body would be buffered whole.
export const MAX_BODY_BYTES = 20 * 1024 * 1024

const TOO_LARGE = "The request body is too large."

/**
 * The raw body, refused once it passes `maxBytes`. The declared length is the
 * cheap early exit; the running count covers a chunked upload that declares none.
 * Returns `tooLarge` as an `invalid` failure when the cap is crossed.
 */
export async function readBytes(
  request: Request,
  maxBytes: number = MAX_BODY_BYTES,
  tooLarge: string = TOO_LARGE
): Promise<ServiceResult<Uint8Array<ArrayBuffer>>> {
  if (Number(request.headers.get("content-length")) > maxBytes) {
    return fail("invalid", tooLarge)
  }
  if (request.body === null) return { ok: true, data: new Uint8Array() }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return fail("invalid", tooLarge)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, data: bytes }
}

/**
 * The body as an untyped JSON object. The service parses it against its own
 * schema, so the route does not validate twice. Anything but an object is
 * refused here: routes spread the body into the input, and a spread array or
 * string would read as a request with no fields at all.
 *
 * `allowEmpty` reads a blank body as `{}`. Test on the text, never on
 * `request.body === null`: Next hands every non-GET handler a stream, empty or not.
 */
export async function readJson(
  request: Request,
  { allowEmpty = false }: { allowEmpty?: boolean } = {}
): Promise<ServiceResult<Record<string, unknown>>> {
  const bytes = await readBytes(request)
  if (!bytes.ok) return bytes
  const text = new TextDecoder().decode(bytes.data)
  if (allowEmpty && text.trim() === "") return { ok: true, data: {} }

  let data: unknown
  try {
    data = JSON.parse(text)
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
