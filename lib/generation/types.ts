// lib/generation/types.ts — Provider-agnostic generation contract.
// Pure types: isomorphic, no imports beyond the domain contract.

import type { GenerationSettings } from "@/lib/types"

/** A lorebook entry selected into context, with why. */
export interface ActiveLoreEntry {
  id: string
  name: string
  content: string
  priority: number
  /** The trigger key that matched recent text, or null when included via alwaysActive. */
  matchedKey: string | null
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
}

export interface GenerationRequest {
  context: ComposedContext
  settings: GenerationSettings
  signal?: AbortSignal
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
export type GenerationEvent =
  | { type: "reasoning"; chars: number }
  | { type: "text"; value: string }
  | { type: "usage"; usage: GenerationUsage }

export interface GenerationProvider {
  /**
   * Yields generation events. Concatenating every `text` event's value gives the
   * full continuation. Stops promptly on signal abort.
   */
  generate(request: GenerationRequest): AsyncIterable<GenerationEvent>
}
