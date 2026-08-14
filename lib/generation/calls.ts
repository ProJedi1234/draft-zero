// lib/generation/calls.ts — The write half of the spend ledger.
//
// Server-only, and called from POST /api/generate rather than from the client
// or from appendGeneratedEntry. Two reasons, both structural: `finalize()` only
// runs when prose survives, so a client-side recorder would miss every Stop and
// every mid-stream provider error — both of which are billed — and a cost that
// arrives over the wire from a browser is a number the browser could have made
// up. The route is the only place that sees every call, including the ones that
// die.
//
// NOTHING IN HERE MAY THROW INTO THE GENERATION PATH. Failing to measure a call
// is a bookkeeping problem; failing the writer's generation because we could not
// measure it is a product problem. Every export swallows its errors and logs.
import "server-only"

import { and, eq, lt, sql, type SQL } from "drizzle-orm"
import type { PgColumn } from "drizzle-orm/pg-core"

import { getDb } from "@/lib/db/client"
import { generationCalls } from "@/lib/db/schema"
import type {
  GenerationCallStatus,
  GenerationRequestKind,
  SettledCallStatus,
  ThinkingLevel,
} from "@/lib/types"

import type { GenerationUsage } from "./types"

/** How long a row may sit in "streaming" before the sweep calls it dead. */
const STUCK_AFTER_MS = 10 * 60 * 1000

export interface CallStart {
  id: string
  /** Null when the request named a story that no longer exists. A cost is still a cost. */
  storyId: string | null
  /**
   * The id the request *named*, verified or not — the FK-free grouping key.
   * Differs from storyId only when the story was already gone at mint.
   */
  origStoryId: string | null
  storyTitle: string | null
  requestKind: GenerationRequestKind
  modelId: string
  thinking: ThinkingLevel | null
  /** The story's pinned endpoint tag, or null for Auto routing. */
  providerName: string | null
}

/**
 * Opens the ledger row, before the first byte reaches the client.
 *
 * One INSERT against a local Postgres, on a path that has already waited for
 * OpenRouter's first event, so it costs the writer nothing visible. This is the
 * write that guarantees an aborted call leaves a trace with somewhere to hang a
 * generation id.
 */
export async function recordCallStarted(call: CallStart): Promise<void> {
  // Fire-and-forget: the sweep is a janitor, not a precondition, and awaiting it
  // would put a second query in front of the writer's first token.
  void sweepStuckCalls()
  try {
    const db = await getDb()
    await db.insert(generationCalls).values({
      id: call.id,
      storyId: call.storyId,
      origStoryId: call.origStoryId,
      storyEntryId: null,
      storyTitle: call.storyTitle,
      requestKind: call.requestKind,
      modelId: call.modelId,
      providerName: call.providerName,
      thinking: call.thinking,
      status: "streaming" satisfies GenerationCallStatus,
      createdAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error("[cost] failed to open ledger row", err)
  }
}

/**
 * Settles the row when the stream ends, whatever way it ended.
 *
 * `usage` is null on every aborted call — usage rides the final chunk and only
 * the final chunk — which is exactly why cost_usd stays NULL here and why
 * reconcileCall exists. A NULL is an honest "we don't know"; a zero would be a
 * lie that sums silently.
 */
export async function settleCall(
  id: string,
  outcome: {
    status: SettledCallStatus
    generationId: string | null
    usage: GenerationUsage | null
  }
): Promise<void> {
  try {
    const db = await getDb()
    const { usage } = outcome
    await db
      .update(generationCalls)
      .set({
        // Lifecycle columns, written unconditionally. A row MUST leave
        // "streaming" whatever else happened to it: every aggregate excludes
        // that status, so a row stuck in it is a cost that exists and cannot be
        // seen — strictly worse than a cost recorded twice.
        status: outcome.status,
        settledAt: new Date().toISOString(),
        openrouterGenerationId: outcome.generationId,
        // Measurement columns, which yield to an already-reconciled row.
        promptTokens: keep(
          generationCalls.promptTokens,
          usage?.promptTokens ?? null,
          "int"
        ),
        completionTokens: keep(
          generationCalls.completionTokens,
          usage?.completionTokens ?? null,
          "int"
        ),
        reasoningTokens: keep(
          generationCalls.reasoningTokens,
          usage?.reasoningTokens ?? null,
          "int"
        ),
        cachedPromptTokens: keep(
          generationCalls.cachedPromptTokens,
          usage?.cachedPromptTokens ?? null,
          "int"
        ),
        // The float → numeric boundary, crossed exactly once, here at the edge.
        // After this the value is decimal all the way to the screen.
        costUsd: keep(
          generationCalls.costUsd,
          toNumericString(usage?.costUsd ?? null),
          "numeric"
        ),
        upstreamPromptCostUsd: keep(
          generationCalls.upstreamPromptCostUsd,
          toNumericString(usage?.upstreamPromptCostUsd ?? null),
          "numeric"
        ),
        upstreamCompletionCostUsd: keep(
          generationCalls.upstreamCompletionCostUsd,
          toNumericString(usage?.upstreamCompletionCostUsd ?? null),
          "numeric"
        ),
        isByok: keep(generationCalls.isByok, usage?.isByok ?? null, "boolean"),
        costSource: keep(
          generationCalls.costSource,
          usage?.costUsd == null ? null : "stream",
          "text"
        ),
      })
      .where(eq(generationCalls.id, id))
  } catch (err) {
    console.error("[cost] failed to settle ledger row", err)
  }
}

/**
 * A settle value that defers to an already-reconciled row.
 *
 * The route starts settleCall and reconcileCall in the same tick and awaits
 * neither, so their two writes race. Reconciliation sleeps a second before its
 * first lookup, which makes settle win essentially always — but "essentially
 * always" is not an invariant, and the losing order is the destructive one:
 * a stopped call settles with `usage === null`, so a settle landing after a
 * reconcile would overwrite OpenRouter's own accounting with NULL. That is
 * precisely the undercount reconciliation exists to prevent, and it would be
 * silent.
 *
 * The cast is not decoration: the ELSE arm binds a parameter that can be null,
 * and Postgres cannot infer a type for a lone NULL parameter inside a CASE.
 */
function keep(
  column: PgColumn,
  value: string | number | boolean | null,
  cast: "int" | "numeric" | "boolean" | "text"
): SQL {
  return sql`case when ${generationCalls.costSource} = 'reconciled' then ${column} else ${value}::${sql.raw(cast)} end`
}

/**
 * Marks long-dead "streaming" rows as errors.
 *
 * If the process dies between the open and the settle, a row sits in
 * "streaming" forever. Every aggregate already excludes that status, so such a
 * row is invisible rather than wrong — but it is also unreconcilable while it
 * looks in-flight, and it makes the ledger read like it is lying. Ten minutes
 * is far longer than any single generation and far shorter than a writing
 * session, so nothing live is ever swept.
 */
export async function sweepStuckCalls(): Promise<void> {
  try {
    const db = await getDb()
    const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString()
    await db
      .update(generationCalls)
      .set({ status: "error", settledAt: new Date().toISOString() })
      .where(
        and(
          eq(generationCalls.status, "streaming"),
          lt(generationCalls.createdAt, cutoff)
        )
      )
  } catch (err) {
    console.error("[cost] failed to sweep stuck ledger rows", err)
  }
}

/**
 * A JS float to the decimal string Drizzle's `numeric` wants, or null.
 *
 * twelve places matches the column's scale, which is comfortably more than the
 * eight or nine a per-call price actually carries — so this rounds nothing that
 * OpenRouter said, and every sum after it happens in Postgres.
 */
function toNumericString(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null
  return value.toFixed(12)
}
