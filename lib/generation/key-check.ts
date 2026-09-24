// lib/generation/key-check.ts — The one network call behind "Verify key", in a
// module of its own so a spec can double it without doubling the whole SDK.
import "server-only"

import { OpenRouter } from "@openrouter/sdk"

/**
 * GET /key — the cheapest call authenticated by a plain inference key.
 * Resolves when OpenRouter accepts the key; throws the SDK's error otherwise.
 */
export async function fetchKeyMetadata(key: string): Promise<void> {
  const client = new OpenRouter({ apiKey: key })
  await client.apiKeys.getCurrentKeyMetadata()
}
