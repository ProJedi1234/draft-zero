// lib/generation/summarize.ts — Writing the rolling summary as the window
// slides. Server-only, and nobody's foreground.
//
// The whole module is fire-and-forget by construction. It is called from the
// one place every generation ends (finishRun, in live.ts) and its failures are
// the writer's problem only when they stop being transient — a refine that
// fails leaves the coverage watermark where it was, and the next turn tries the
// same batch again for free. That is why there is no retry loop here: the next
// turn IS the retry.
//
// NOTHING IN HERE MAY THROW INTO THE GENERATION PATH, for the same reason
// nothing in calls.ts may: losing a summary is a bookkeeping problem, losing
// the writer's paragraph is not.
import "server-only"

import { getDb } from "@/lib/db/client"
import {
  getStory,
  listLorebookEntries,
  resolveStoryRecap,
} from "@/lib/db/queries"
import { storyRecaps } from "@/lib/db/schema"
import {
  recordCallStarted,
  settleCall,
  type CallStart,
} from "@/lib/generation/calls"
import { composeContext } from "@/lib/generation/context"
import { resolveOpenRouterKey } from "@/lib/generation/key"
import { completeOnce, mapOpenRouterError } from "@/lib/generation/openrouter"
import { planSummary, summaryWordTarget } from "@/lib/generation/summary-plan"
import {
  renderSummaryRequest,
  renderSummarySystemPrompt,
} from "@/lib/generation/summary-prompt"
import type { GenerationUsage } from "@/lib/generation/types"
import { publishBus } from "@/lib/sync/bus"
import type {
  GenerationRequestKind,
  LorebookEntry,
  SettledCallStatus,
  Story,
  StoryRecap,
} from "@/lib/types"

/**
 * Everything this module touches that is not itself.
 *
 * Passed in rather than imported directly at the call sites below, for one
 * blunt reason: a background job that reads a database, spends money and
 * publishes to every connected device is otherwise only testable by replacing
 * those modules globally — and this suite shares one process, so a module
 * replaced here is replaced for the files that are actually testing it. The
 * seam keeps the fakes local to the test that wants them.
 *
 * `liveIo` below is the real thing, and is what every production path uses.
 */
export interface SummaryIo {
  getStory(storyId: string): Promise<Story | null>
  listLore(storyId: string): Promise<LorebookEntry[]>
  resolveRecap(storyId: string): Promise<StoryRecap | null>
  /** Null when OpenRouter is unconfigured — the offline mock path. */
  apiKey(): string | null
  complete(opts: {
    system: string
    user: string
    modelId: string
    temperature: number
    maxTokens: number
    zdr: boolean
    key: string
    signal?: AbortSignal
  }): Promise<{
    text: string
    generationId: string | null
    usage: GenerationUsage | null
  }>
  openCall(call: CallStart): Promise<void>
  settle(
    id: string,
    outcome: {
      status: SettledCallStatus
      generationId: string | null
      usage: GenerationUsage | null
    }
  ): Promise<void>
  storeRecap(row: {
    id: string
    storyId: string
    throughEntryId: string
    throughPosition: number
    text: string
    genModelId: string
    createdAt: string
  }): Promise<void>
  announceStopped(storyId: string): void
}

export const liveIo: SummaryIo = {
  getStory,
  listLore: listLorebookEntries,
  resolveRecap: resolveStoryRecap,
  apiKey: resolveOpenRouterKey,
  complete: completeOnce,
  openCall: recordCallStarted,
  settle: settleCall,
  async storeRecap(row) {
    const db = await getDb()
    await db.insert(storyRecaps).values(row)
  },
  announceStopped(storyId) {
    publishBus({ kind: "summary-stopped", storyId })
  },
}

/**
 * What writes the summaries.
 *
 * A constant, not a setting. The job is mechanical — compress prose without
 * losing names — and the model that is good at it is not the one the writer
 * picked to write their book: a story on a frontier model would otherwise pay
 * frontier prices, silently, every few passages. Haiku is cheap, fast enough
 * that nobody notices it running, and has providers that retain nothing, which
 * is what keeps the zero-retention path satisfiable.
 *
 * Sampling is fixed for the same reason. Low temperature because faithful
 * compression is not a creative task, and the two penalties are pinned to zero
 * on purpose: a summary has to repeat the names, places and debts that matter,
 * and a frequency penalty punishes exactly that.
 */
const SUMMARIZER_MODEL_ID = "~anthropic/claude-haiku-latest"
const SUMMARIZER_TEMPERATURE = 0.3
/** Generous against the word target — the target is a request, not a limit. */
const SUMMARIZER_MAX_TOKEN_FACTOR = 3
/** How long one refine may take before it is abandoned as hung. */
const SUMMARIZE_TIMEOUT_MS = 60_000
/**
 * Consecutive failures before this story stops trying.
 *
 * The unmoved watermark makes retrying free, which is right for a rate limit
 * and wrong for anything permanent: a retired model or an unroutable retention
 * policy would otherwise fire a doomed call every turn forever, visible only as
 * a slow drift of error rows on the usage page. Three strikes is enough to ride
 * out a blip and short enough that a real breakage is reported while the writer
 * is still in the session that caused it.
 */
const FAILURE_LIMIT = 3

/**
 * Held on globalThis for the same reason the run registry is (see live.ts): dev
 * HMR re-evaluates this module while a refine is still in flight against the
 * old copy, and two registries means the per-story guard stops guarding and a
 * story summarizes itself twice at once.
 */
const globalForSummary = globalThis as unknown as {
  __draftZeroSummary?: {
    /** Stories with a refine in flight — one at a time, the whole concurrency rule. */
    inFlight: Set<string>
    /** Consecutive failures per story; cleared by any success. */
    failures: Map<string, number>
    /** Stories that have given up until the process restarts or a story changes. */
    tripped: Set<string>
  }
}

const registry = (globalForSummary.__draftZeroSummary ??= {
  inFlight: new Set(),
  failures: new Map(),
  tripped: new Set(),
})
registry.inFlight ??= new Set()
registry.failures ??= new Map()
registry.tripped ??= new Set()

/**
 * Bring a story's summary up to date if the window has moved past what it
 * covers. Safe to call after every turn; the common answer is to do nothing.
 *
 * Never awaited by the caller and never throws — the promise is floated so a
 * writer's turn finishes at the moment their prose lands, not when bookkeeping
 * about it finishes.
 */
export function scheduleSummary(storyId: string): void {
  void runSummaryForStory(storyId).catch((err) => {
    // Unreachable in principle: runSummary handles its own failures. Here so
    // that a bug in the handling cannot take the process down with it.
    console.error("[summary] escaped", err)
  })
}

/**
 * The awaitable form. `scheduleSummary` is the one the run loop uses; this one
 * exists because "did it try, and what did it conclude" is only answerable by
 * waiting, and the guard and the breaker are the parts worth pinning.
 */
export async function runSummaryForStory(
  storyId: string,
  io: SummaryIo = liveIo
): Promise<void> {
  if (registry.tripped.has(storyId)) return
  // Not a queue. A second refine for the same story is dropped rather than
  // deferred, because by the time the first one lands the second's plan is
  // stale anyway — and the next turn will ask the same question again.
  if (registry.inFlight.has(storyId)) return
  registry.inFlight.add(storyId)
  try {
    await summarizeOnce(storyId, io)
  } catch (err) {
    console.error("[summary] failed", err)
    noteFailure(storyId, io)
  } finally {
    registry.inFlight.delete(storyId)
  }
}

async function summarizeOnce(storyId: string, io: SummaryIo): Promise<void> {
  const key = io.apiKey()
  // No key means the app is running on the offline mock, where a fabricated
  // summary would be indistinguishable from a real one the next time anybody
  // read the story. Nothing is written and nothing is a failure.
  if (key === null) return

  const story = await io.getStory(storyId)
  if (story === null) return

  const lorebookEntries = await io.listLore(storyId)
  // Composed rather than reasoned about: this is the same function the turn
  // itself ran, so its record of where the window began is the turn's own
  // answer and not a second opinion.
  const context = composeContext({ story, lorebookEntries })
  const recap = await io.resolveRecap(storyId)
  const plan = planSummary({
    entries: story.entries,
    trim: context.trim,
    recap,
  })
  if (plan === null) return

  const targetWords = summaryWordTarget(story.settings.contextWindow)
  const callId = crypto.randomUUID()
  const requestKind: GenerationRequestKind = "summarize"
  // Opened before the request for the same reason a generation's row is: a call
  // that dies mid-flight was still billed, and this is the only trace it leaves.
  await io.openCall({
    id: callId,
    storyId,
    origStoryId: storyId,
    storyTitle: story.title,
    requestKind,
    modelId: SUMMARIZER_MODEL_ID,
    thinking: null,
    providerName: null,
  })

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), SUMMARIZE_TIMEOUT_MS)
  let status: SettledCallStatus = "error"
  try {
    const result = await io.complete({
      system: renderSummarySystemPrompt(targetWords),
      user: renderSummaryRequest({
        previous: recap?.text ?? "",
        newProse: plan.newProse,
        memory: story.memory,
        targetWords,
      }),
      modelId: SUMMARIZER_MODEL_ID,
      temperature: SUMMARIZER_TEMPERATURE,
      maxTokens: Math.round(targetWords * SUMMARIZER_MAX_TOKEN_FACTOR),
      // The story's own flag, already ORed with the app-wide floor by
      // resolveGenerationSettings. Fail-closed lives downstream: with this set
      // OpenRouter refuses rather than routing to a host that retains prompts.
      zdr: story.settings.zdr,
      key,
      signal: abort.signal,
    })
    const text = result.text.trim()
    if (text === "") {
      // A model that answered with nothing is a failed refine, not a summary
      // that says nothing — writing it would erase a good previous version.
      status = "error"
      await io.settle(callId, {
        status,
        generationId: result.generationId,
        usage: result.usage,
      })
      noteFailure(storyId, io)
      return
    }

    await io.storeRecap({
      id: crypto.randomUUID(),
      storyId,
      throughEntryId: plan.throughEntryId,
      throughPosition: plan.throughPosition,
      text,
      genModelId: SUMMARIZER_MODEL_ID,
      createdAt: new Date().toISOString(),
    })
    status = "ok"
    await io.settle(callId, {
      status,
      generationId: result.generationId,
      usage: result.usage,
    })
    registry.failures.delete(storyId)
  } catch (err) {
    // A refusal and a fault settle the row identically: both are billed at zero
    // and both leave the watermark where it was. The distinction the writer
    // cares about — is this going to keep happening — is the breaker's job.
    await io.settle(callId, {
      status: abort.signal.aborted ? "aborted" : "error",
      generationId: null,
      usage: null,
    })
    const { message } = mapOpenRouterError(err)
    console.error("[summary]", message)
    noteFailure(storyId, io)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Count a failure, and trip once they stop looking transient.
 *
 * The count lives in memory rather than on the story: it is runtime state about
 * a process, not a fact about a manuscript, and a restart is a perfectly good
 * moment to try again — most of what breaks this permanently (a bad key, a
 * retired model) is fixed by exactly the restart that clears it.
 */
function noteFailure(storyId: string, io: SummaryIo): void {
  const count = (registry.failures.get(storyId) ?? 0) + 1
  registry.failures.set(storyId, count)
  if (count < FAILURE_LIMIT) return
  registry.tripped.add(storyId)
  // One message, at the moment it becomes the writer's problem to fix. The
  // transient failures before it were never worth interrupting a sentence for.
  io.announceStopped(storyId)
}

/** Test seam: forget every story's failure history. */
export function resetSummaryState(): void {
  registry.inFlight.clear()
  registry.failures.clear()
  registry.tripped.clear()
}
