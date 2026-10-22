// lib/mcp/tools/test-catalog.ts — keeps the model catalog offline for specs
// whose tools check model ids.
//
// Another spec may leave a fake OpenRouter key registered, and with a key the
// catalog fetches. Keyless, it answers with MOCK_MODELS, which
// loadModelCatalog treats as the real catalog.
import { mock } from "bun:test"

export function installKeylessCatalog(): void {
  mock.module("@/lib/generation/key", () => {
    const resolveOpenRouterKey = () => null
    return {
      resolveOpenRouterKey,
      resolveKeyForModel: (modelId: string) =>
        modelId.startsWith("ollama:") ? "" : resolveOpenRouterKey(),
    }
  })
}
