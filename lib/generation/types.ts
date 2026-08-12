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
  /** Ordered priority DESC (then id ASC). Already budget-trimmed. */
  lore: ActiveLoreEntry[]
  /** Recent story prose window (authors note NOT baked in — renderPrompt injects it). */
  storyText: string
  authorsNote: string
  /** Ephemeral instruction (instruction mode), else null. */
  instruction: string | null
  /** Deterministic seed: entryCount at composition time + variant. Drives mock fixture choice. */
  seed: number
  /** estimateTokens of the system prompt + renderPrompt(ctx) — for the inspector context meter. */
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
