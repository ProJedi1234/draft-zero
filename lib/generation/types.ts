// lib/generation/types.ts — Provider-agnostic generation contract.
// Pure types: isomorphic, no imports beyond the domain contract.

import type { LoreTrigger } from "@/lib/generation/lorebook"
import type { GenerationRequestKind, GenerationSettings } from "@/lib/types"

/** A lorebook entry selected into context, with why. */
export interface ActiveLoreEntry {
  id: string
  name: string
  content: string
  priority: number
  /** The trigger key that matched, or null when included via alwaysActive. */
  matchedKey: string | null
  /** Rounds of cascade from a scan source; 0 is a direct match or always-on. */
  depth: number
  /** What put it in context — a scan source or another entry — or null for always-on. */
  triggeredBy: LoreTrigger | null
  /**
   * True when this entry's activation does not depend on the story window, so
   * it is sent in the cacheable head of the prompt rather than beside the
   * recent prose. See composeContext.
   */
  stable: boolean
}

/**
 * The five things a prompt is assembled from, in the order they are sent.
 *
 * "system" never appears in renderPrompt — it rides the system message — but it
 * is part of what the budget pays for, so it is a section like any other.
 */
export type ContextSectionId =
  "system" | "memory" | "lore" | "story" | "authorsNote"

/** One labelled piece of the rendered user turn. See promptBlocks. */
export interface PromptBlock {
  section: ContextSectionId
  /** Lore only: which entry this block renders. */
  loreId?: string
  text: string
}

/**
 * What each trimmable source offered against what survived the budget.
 *
 * Recorded because the composed context cannot answer it after the fact: an
 * entry that did not fit is simply absent, and absent is indistinguishable from
 * "never triggered". This is the difference between a viewer that shows what
 * was sent and one that can tell a writer their lorebook is being dropped.
 */
export interface ContextFit {
  /** Lore entries the scan triggered, before the budget had its say. */
  loreMatched: number
  /** How many of those were stable — the cacheable head's share of them. */
  loreStableMatched: number
  /** Characters of manuscript prose the story offered… */
  storyChars: number
  /** …and how many of them the budget had room for. */
  storyCharsKept: number
}

/** Fully composed generation context — everything a provider needs, provider-agnostic. */
export interface ComposedContext {
  /** Already resolved: the story's override, or the built-in default. Sent as the system message. */
  systemPrompt: string
  memory: string
  /**
   * Ordered priority DESC (then id ASC). Already trimmed to its share of the
   * story's contextWindow token budget — entries that did not fit are absent.
   */
  lore: ActiveLoreEntry[]
  /**
   * Recent story prose window, trimmed from the tail to whatever the
   * contextWindow budget had left over (authors note NOT baked in — renderPrompt
   * injects it).
   */
  storyText: string
  authorsNote: string
  /** Deterministic seed: entryCount at composition time + variant. Drives mock fixture choice. */
  seed: number
  /**
   * estimateTokens of the system prompt + renderPrompt(ctx) — for the inspector
   * context meter. composeContext trims until this is <= the story's
   * contextWindow; it can still exceed it when the fixed overhead (system
   * prompt, memory, author's note) alone does not fit, since none of that is
   * trimmable.
   */
  approxTokens: number
  /** What the budget could not fit — for the context viewer. */
  fit: ContextFit
}

export interface GenerationRequest {
  context: ComposedContext
  settings: GenerationSettings
  signal?: AbortSignal
  /**
   * Which story is being billed. Sent so the route can open a ledger row before
   * the first byte — the client is never the recorder, but it is the only place
   * that knows which manuscript the request belongs to. Optional because the
   * offline mock records nothing.
   */
  storyId?: string
  /** Which move triggered this, for the ledger. */
  requestKind?: GenerationRequestKind
}

/**
 * Exact token counts, from the provider rather than estimated. OpenRouter sends
 * these once, in the FINAL stream chunk, so nothing can show them mid-flight —
 * see the `reasoning` event for what is available while the model is still
 * working.
 */
export interface GenerationUsage {
  promptTokens: number
  completionTokens: number
  /** Tokens spent thinking. 0 on a model that did not reason. */
  reasoningTokens: number
  /**
   * What OpenRouter charged for this call, USD. Null when it declined to price
   * it, and null on the offline mock — a fabricated number here would be
   * indistinguishable from a record once it reached the ledger.
   */
  costUsd: number | null
  /** Prompt tokens served from cache. A subset of promptTokens, not an addition. */
  cachedPromptTokens: number | null
  /** Upstream split, for the "why was this expensive" breakdown only. */
  upstreamPromptCostUsd: number | null
  upstreamCompletionCostUsd: number | null
  /** True when the call rode a Bring-Your-Own-Key configuration. */
  isByok: boolean | null
}

/**
 * One thing the provider has to say. The stream used to be bare strings, which
 * left the client unable to tell "the request is in flight" from "the model has
 * been reasoning for eight seconds" — both looked like silence, and the UI had
 * nothing truthful to show for the wait.
 *
 * `reasoning` deliberately carries a CHARACTER COUNT and not the text. Hiding
 * the model's reasoning from the manuscript and knowing that it is happening are
 * separable concerns, and dropping the deltas outright gave up both. Nothing
 * downstream can reconstruct the reasoning from a number, so the "the manuscript
 * only ever receives prose" rule still holds by construction.
 */
/**
 * `meta` is the identity of the call, sent as early as it is known and never
 * repeated. It exists because usage rides the FINAL chunk exclusively: a
 * generation the writer stops has real tokens billed against it and no usage
 * event at all, so the only way to ever learn what it cost is to have kept the
 * handle OpenRouter answers questions about. `callId` is our own ledger row, so
 * the client can link the passage it is about to persist back to the money.
 */
export type GenerationEvent =
  | { type: "reasoning"; chars: number }
  | { type: "text"; value: string }
  | { type: "usage"; usage: GenerationUsage }
  | {
      type: "meta"
      /** OpenRouter's generation id, or null before/without one. */
      generationId: string | null
      /** The ledger row. Null on the offline mock, which records nothing. */
      callId: string | null
    }

export interface GenerationProvider {
  /**
   * Yields generation events. Concatenating every `text` event's value gives the
   * full continuation. Stops promptly on signal abort.
   */
  generate(request: GenerationRequest): AsyncIterable<GenerationEvent>
}
