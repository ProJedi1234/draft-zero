// lib/images/types.ts — Provider-agnostic image generation contract.
// Pure types: isomorphic, no imports beyond the domain contract.

import type { ImageAspectRatio } from "@/lib/types"

export interface ImageGenerationRequest {
  /** The scene, as the writer left it. Style is the profile's business. */
  prompt: string
  /**
   * The image model to draw with, or null to follow the catalog's first entry.
   * A real provider sends this as `model`; the offline mock only folds it into
   * the seed, so choosing a model visibly changes the picture without any claim
   * that the named model drew it.
   */
  modelId: string | null
  /**
   * The story's effective retention policy (its own switch, or the app floor
   * resolve folds in). A live provider must route retention-free or refuse;
   * the offline mock ignores it, since a picture drawn in the browser never
   * leaves the machine.
   */
  zdr: boolean
  aspectRatio: ImageAspectRatio
  /**
   * Deterministic seed. Takes of one slot differ only in this, which is what
   * makes "retry" mean "another draw of the same scene" rather than "a
   * different scene".
   */
  seed: number
  signal?: AbortSignal
}

/**
 * What a finished generation cost.
 *
 * Separate from the text side's GenerationUsage because the units genuinely
 * differ: OpenRouter bills images per output_image / input_image / megapixel,
 * and the token counts it returns alongside are an accounting artefact rather
 * than something a writer can reason about. `costUsd` is the only number worth
 * surfacing, and it is null offline for the usual reason — an invented figure
 * would be indistinguishable from a billed one downstream.
 */
export interface ImageUsage {
  costUsd: number | null
  /**
   * OpenRouter reports token counts alongside the price even for images. They
   * are an accounting artefact rather than something a writer reasons about,
   * but the ledger has columns for them and a recorded number beats a null.
   */
  promptTokens: number | null
  completionTokens: number | null
}

/**
 * One thing an image provider has to say.
 *
 * `partial` exists because OpenRouter genuinely streams progressively-refined
 * previews for the GPT-Image class of models (`image_generation.partial_image`
 * events), and a blurry frame that sharpens is the honest picture of what is
 * happening. Models that do not stream simply never emit one, and the UI holds
 * its shimmer — the absence of partials is a property of the model, not an
 * error state, so nothing downstream may treat it as one.
 *
 * Both `partial` and `completed` carry base64 rather than bytes so the same
 * events can cross a network boundary unchanged when a real provider runs
 * server-side.
 */
export type ImageGenerationEvent =
  | { type: "partial"; index: number; b64: string; mediaType: string }
  | {
      type: "completed"
      b64: string
      mediaType: string
      usage: ImageUsage
    }

export interface ImageGenerationProvider {
  /** Yields events until `completed`, or stops promptly on signal abort. */
  generate(request: ImageGenerationRequest): AsyncIterable<ImageGenerationEvent>
}
