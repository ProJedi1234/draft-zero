// lib/generation/reconcile.ts — Asking OpenRouter what a call actually cost.
//
// Only ever needed for a call that did NOT finish. Usage rides the final stream
// chunk and only the final chunk, so a generation the writer stopped — or one a
// provider killed mid-sentence — yields no usage event at all, while OpenRouter
// has nonetheless billed for everything it generated. Without this lookup every
// Stop is an invisible undercount, and Stop is not a rare move.
//
// A completed call is deliberately never reconciled: its streamed cost is
// authoritative and the round trip would buy nothing.
import "server-only"

import { sql } from "drizzle-orm"

import { getDb } from "@/lib/db/client"
import { generationCalls } from "@/lib/db/schema"

const GENERATION_URL = "https://openrouter.ai/api/v1/generation"

/**
 * Backoff before each attempt. The record is not queryable the instant the
 * stream dies — ask too soon and OpenRouter 404s — and it is written within a
 * few seconds. Three tries spread across ~15s, then we stop: a NULL cost is an
 * honest "we don't know", and retrying for longer would keep a request's
 * lifetime open over money we merely failed to measure.
 */
const ATTEMPT_DELAYS_MS = [1_000, 4_000, 10_000]

/** The subset of OpenRouter's /generation payload the ledger stores. */
interface GenerationRecord {
  total_cost?: number | null
  native_tokens_prompt?: number | null
  native_tokens_completion?: number | null
  native_tokens_reasoning?: number | null
  provider_name?: string | null
  is_byok?: boolean | null
}

/**
 * Fills in what a stopped or errored call cost, best-effort.
 *
 * Scheduled with `after()` from the route, so it runs once the response has
 * finished streaming and never delays a token. It cannot throw: the response is
 * already sent, and an unhandled rejection here would be noise about a
 * measurement, not about the writer's prose.
 */
export async function reconcileCall(
  callId: string,
  generationId: string,
  key: string
): Promise<void> {
  try {
    const record = await fetchGeneration(generationId, key)
    if (!record) return

    // Fill, never erase. The record is authoritative about what it CONTAINS and
    // says nothing about what it omits, so only the fields it actually carries
    // are written and every other column keeps whatever was already measured.
    //
    // This is not hypothetical: a stop lands on `status: 'aborted'` whenever the
    // signal tripped by the time the loop exited, including when the final chunk
    // — the one carrying usage — arrived a beat earlier. Such a row is already
    // settled with a real streamed cost and a pinned provider tag, and a
    // /generation payload with `total_cost: null` (BYOK traffic, or a record
    // written before pricing settled) would otherwise overwrite a number we know
    // with "we never measured this".
    const patch: Partial<typeof generationCalls.$inferInsert> = {}
    if (record.total_cost != null) {
      patch.costUsd = record.total_cost.toFixed(12)
      // Moves with the figure it describes, always. cost_source is the
      // provenance of cost_usd and it is also the flag settleCall's `keep`
      // reads, so writing one without the other would either mislabel a
      // streamed figure or leave a reconciled one unguarded.
      patch.costSource = "reconciled"
    }
    if (record.native_tokens_prompt != null) {
      patch.promptTokens = record.native_tokens_prompt
    }
    if (record.native_tokens_completion != null) {
      patch.completionTokens = record.native_tokens_completion
    }
    if (record.native_tokens_reasoning != null) {
      patch.reasoningTokens = record.native_tokens_reasoning
    }
    // The endpoint that actually served the call — the thing this lookup knows
    // and the stream does not on an Auto-routed generation. Absent from the
    // record, the story's pinned tag written at recordCallStarted stands.
    if (record.provider_name != null) {
      patch.providerName = record.provider_name
    }
    if (record.is_byok != null) patch.isByok = record.is_byok

    // Nothing worth saying. An UPDATE with an empty SET is not a statement.
    if (Object.keys(patch).length === 0) return

    const db = await getDb()
    await db
      .update(generationCalls)
      .set(patch)
      // Never downgrade. A reconciled figure is OpenRouter's own accounting and
      // outranks the streamed one; the guard is here because a stream settle and
      // this lookup are two writes with no ordering guarantee between them.
      .where(
        sql`${generationCalls.id} = ${callId} and (${generationCalls.costSource} is distinct from 'reconciled')`
      )
  } catch (err) {
    console.error("[cost] reconciliation failed", err)
  }
}

/** Polls /generation until the record exists, or gives up. */
async function fetchGeneration(
  generationId: string,
  key: string
): Promise<GenerationRecord | null> {
  for (const wait of ATTEMPT_DELAYS_MS) {
    await sleep(wait)
    try {
      const res = await fetch(
        `${GENERATION_URL}?id=${encodeURIComponent(generationId)}`,
        { headers: { authorization: `Bearer ${key}` }, cache: "no-store" }
      )
      // 404 is the expected "not written yet" answer, not a failure.
      if (res.status === 404) continue
      if (!res.ok) return null
      const payload: { data?: GenerationRecord } = await res.json()
      if (payload?.data) return payload.data
    } catch {
      // Network flake: fall through to the next attempt.
    }
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Reconciliation is only worth a round trip for a call that never finished. */
export function shouldReconcile(
  status: "ok" | "aborted" | "error",
  generationId: string | null
): generationId is string {
  return status !== "ok" && generationId !== null
}
