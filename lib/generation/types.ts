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

export interface GenerationProvider {
  /** Yields plain-text chunks. Concatenation of all chunks = the full continuation. Stops promptly on signal abort. */
  generate(request: GenerationRequest): AsyncIterable<string>
}
