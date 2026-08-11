// lib/generation/mock-provider.ts — Deterministic, offline GenerationProvider.
// Runs identically in the browser and on the server: fixture data + setTimeout,
// no I/O, no randomness, no network. Same output for the same context.seed.

import { FIXTURE_CONTINUATIONS, chunkText } from "./fixtures"
import type { GenerationProvider, GenerationRequest } from "./types"

export interface MockProviderOptions {
  /** Delay before the first chunk — exercises the "pending" UI state. Default 350. */
  initialDelayMs?: number
  /** Delay between chunks — exercises streaming UI. Default 24. */
  chunkDelayMs?: number
  /** Fixture pool override for tests. Default FIXTURE_CONTINUATIONS. */
  fixtures?: readonly string[]
}

const DEFAULT_INITIAL_DELAY_MS = 350
const DEFAULT_CHUNK_DELAY_MS = 24
const VERIFY_DELAY_MS = 600

const VALID_KEY_MESSAGE = "Key looks valid (mock check)."
const INVALID_KEY_MESSAGE = "That doesn't look like an OpenRouter key."

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
  private readonly fixtures: readonly string[]

  constructor(options: MockProviderOptions = {}) {
    this.initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
    this.chunkDelayMs = options.chunkDelayMs ?? DEFAULT_CHUNK_DELAY_MS
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
   */
  async *generate(request: GenerationRequest): AsyncGenerator<string> {
    const { context, settings, signal } = request
    const pool = this.fixtures
    const index = ((context.seed % pool.length) + pool.length) % pool.length
    const text = truncateToWords(pool[index], settings.maxTokens)
    if (text === "") return

    await delay(this.initialDelayMs, signal)
    for (const chunk of chunkText(text)) {
      if (signal?.aborted) return
      yield chunk
      await delay(this.chunkDelayMs, signal)
    }
  }

  /** Shape-only check — the key never leaves this machine in this milestone. */
  async verifyKey(key: string): Promise<{ ok: boolean; message: string }> {
    await delay(VERIFY_DELAY_MS)
    const ok = key.startsWith("sk-or-") && key.length >= 20
    return { ok, message: ok ? VALID_KEY_MESSAGE : INVALID_KEY_MESSAGE }
  }
}
