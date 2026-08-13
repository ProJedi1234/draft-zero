// lib/generation/mock-provider.ts — Deterministic, offline GenerationProvider.
// Runs identically in the browser and on the server: fixture data + setTimeout,
// no I/O, no randomness, no network. Same output for the same context.seed.

import { estimateTokens } from "./context"
import { FIXTURE_CONTINUATIONS, chunkText } from "./fixtures"
import type {
  GenerationEvent,
  GenerationProvider,
  GenerationRequest,
} from "./types"

export interface MockProviderOptions {
  /** Delay before the first chunk — exercises the "pending" UI state. Default 350. */
  initialDelayMs?: number
  /** Delay between chunks — exercises streaming UI. Default 24. */
  chunkDelayMs?: number
  /** Delay between reasoning ticks — exercises the "thinking" UI state. Default 90. */
  reasoningDelayMs?: number
  /** Fixture pool override for tests. Default FIXTURE_CONTINUATIONS. */
  fixtures?: readonly string[]
}

const DEFAULT_INITIAL_DELAY_MS = 350
const DEFAULT_CHUNK_DELAY_MS = 24
const DEFAULT_REASONING_DELAY_MS = 90

/**
 * Reasoning ticks per thinking level. The offline path is where the thinking UI
 * is actually developed and reviewed — without this the "thinking" state would
 * only ever be reachable with a real key and a reasoning model, which is to say
 * never during a design pass.
 */
const REASONING_TICKS: Record<string, number> = {
  minimal: 4,
  low: 8,
  medium: 14,
  high: 20,
  xhigh: 28,
  max: 36,
}

/** Resolves after `ms`, or immediately once `signal` aborts. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/** First `maxWords` whitespace-delimited words, whitespace between them preserved. */
function truncateToWords(text: string, maxWords: number): string {
  if (!Number.isFinite(maxWords) || maxWords <= 0) return ""
  const tokens = text.match(/\s+|\S+/g)
  if (!tokens) return ""

  let out = ""
  let words = 0
  for (const token of tokens) {
    if (!/^\s/.test(token)) {
      if (words === maxWords) break
      words += 1
    }
    out += token
  }
  return words === 0 ? "" : out.replace(/\s+$/, "")
}

export class MockGenerationProvider implements GenerationProvider {
  private readonly initialDelayMs: number
  private readonly chunkDelayMs: number
  private readonly reasoningDelayMs: number
  private readonly fixtures: readonly string[]

  constructor(options: MockProviderOptions = {}) {
    this.initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
    this.chunkDelayMs = options.chunkDelayMs ?? DEFAULT_CHUNK_DELAY_MS
    this.reasoningDelayMs =
      options.reasoningDelayMs ?? DEFAULT_REASONING_DELAY_MS
    this.fixtures =
      options.fixtures && options.fixtures.length > 0
        ? options.fixtures
        : FIXTURE_CONTINUATIONS
  }

  /**
   * The continuation is `fixtures[context.seed % fixtures.length]`, truncated to
   * `settings.maxTokens` words. Consecutive passages therefore cycle through the
   * pool, and a Retry (incremented variant → incremented seed) yields a
   * different text than the one it replaces — deterministically.
   *
   * When the story asks for thinking, a run of `reasoning` events comes first,
   * so the offline path moves through pending → thinking → streaming exactly as
   * a real reasoning model does. Their character counts are a fixed function of
   * the tick index, not random: the mock's whole contract is that the same seed
   * produces the same run.
   */
  async *generate(request: GenerationRequest): AsyncGenerator<GenerationEvent> {
    const { context, settings, signal } = request
    const pool = this.fixtures
    const index = ((context.seed % pool.length) + pool.length) % pool.length
    const text = truncateToWords(pool[index], settings.maxTokens)
    if (text === "") return

    await delay(this.initialDelayMs, signal)

    let reasoningChars = 0
    const ticks = REASONING_TICKS[settings.thinking] ?? 0
    for (let i = 0; i < ticks; i++) {
      if (signal?.aborted) return
      const chars = 40 + ((i * 7) % 30)
      reasoningChars += chars
      yield { type: "reasoning", chars }
      await delay(this.reasoningDelayMs, signal)
    }

    for (const chunk of chunkText(text)) {
      if (signal?.aborted) return
      yield { type: "text", value: chunk }
      await delay(this.chunkDelayMs, signal)
    }

    // Deliberately not emitted on an aborted run: a stopped generation has no
    // settled usage, and inventing one would put a confident number under a
    // passage the writer cut short.
    if (signal?.aborted) return
    yield {
      type: "usage",
      usage: {
        promptTokens: context.approxTokens,
        completionTokens: estimateTokens(text),
        // Same ceil(chars / 4) rule estimateTokens applies, but the reasoning
        // text itself never existed here — only its length ever did.
        reasoningTokens: Math.ceil(reasoningChars / 4),
      },
    }
  }
}
