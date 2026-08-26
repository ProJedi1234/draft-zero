// lib/images/openrouter.ts — Live image generation. Server-only.
//
// A plain fetch rather than the SDK: OpenRouter's /api/v1/images surface is
// newer than the SDK version this project pins, so the request and response are
// narrowed by hand here. The same reason lib/images/models.ts fetches its
// catalog directly.
import "server-only"

import type { ImageAspectRatio } from "@/lib/types"

import { zdrTagsForModel } from "@/lib/generation/zdr"

import { imageProviderParam } from "./moderation"
import type {
  ImageGenerationEvent,
  ImageGenerationProvider,
  ImageGenerationRequest,
} from "./types"

const ENDPOINT = "https://openrouter.ai/api/v1/images"

/** Maps a failed image request to a message safe to show the writer. */
export function mapImageError(status: number, body: string): string {
  switch (status) {
    case 401:
      return "OpenRouter rejected the API key. Check Settings."
    case 402:
      return "OpenRouter credits exhausted. Top up your account."
    case 429:
      return "OpenRouter rate limit hit. Wait a moment and retry."
    case 502:
    case 503:
      return "The image provider is unavailable. Try again or switch models."
    default: {
      // The provider's own message when there is one — for images it is
      // usually the useful half (a refused prompt, an unsupported ratio), and
      // burying it under a generic string sends the writer to the logs.
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string } }
        if (parsed.error?.message) return parsed.error.message
      } catch {
        // Not JSON; fall through to the generic message.
      }
      return "The image request failed. Try again."
    }
  }
}

interface RawImageResponse {
  data?: { b64_json?: string; media_type?: string }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    cost?: number
  }
}

/**
 * The real thing: one image from OpenRouter's unified image endpoint.
 *
 * Buffered, not streamed. Partial previews exist only for the GPT-Image class
 * (`supports_streaming` in the catalog), so streaming would be a second code
 * path serving a minority of models — and the UI already treats "no partials"
 * as an ordinary state rather than an error, because for most models it is the
 * only state. Worth adding later; not worth branching on now.
 */
export class OpenRouterImageProvider implements ImageGenerationProvider {
  constructor(private readonly key: string) {}

  async *generate(
    request: ImageGenerationRequest
  ): AsyncGenerator<ImageGenerationEvent> {
    const { prompt, modelId, zdr, aspectRatio, seed, signal } = request
    if (!modelId) throw new Error("No image model selected.")

    // Refused here, before any request, with a message that names the actual
    // problem. Sending it anyway would surface OpenRouter's 404, which points
    // the writer at their account's privacy page — the wrong lever when the
    // real fix is picking one of the models the picker leaves selectable.
    const zdrTags = zdr ? [...(await zdrTagsForModel(modelId))] : []
    if (zdr && zdrTags.length === 0) {
      throw new Error(
        "This model has no zero-data-retention endpoint. Pick one of the models the picker leaves selectable, or turn the story's retention switch off."
      )
    }

    const provider = imageProviderParam(modelId, zdr, zdrTags)

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
        // Same attribution the text side sends, so image spend is
        // distinguishable from prose spend in OpenRouter's own dashboard.
        "X-Title": "draft-zero",
      },
      body: JSON.stringify({
        model: modelId,
        // Sent verbatim. There is nowhere for a house style to come from since
        // image profiles were dropped, and appending one invented here would
        // put words in the request that the writer cannot see or edit.
        prompt,
        n: 1,
        aspect_ratio: aspectRatio satisfies ImageAspectRatio,
        // Sent so a retry is a genuinely different draw rather than a cache
        // hit. Models that do not support it ignore the field.
        seed,
        // Most of the catalog has no knob at all, so this is spread rather
        // than set — JSON.stringify would drop an undefined either way, but
        // the spread says at the call site that absent is the ordinary case.
        ...(provider ? { provider } : {}),
        stream: false,
      }),
      signal,
    })

    if (!res.ok) {
      throw new Error(mapImageError(res.status, await res.text()))
    }

    const body = (await res.json()) as RawImageResponse
    const first = body.data?.[0]
    if (!first?.b64_json) {
      throw new Error("The image provider returned no image.")
    }

    yield {
      type: "completed",
      b64: first.b64_json,
      // PNG is the endpoint's default and what every provider returns unless
      // asked otherwise; the field is optional in the response.
      mediaType: first.media_type ?? "image/png",
      usage: {
        // Exact, from the provider. Null only if it declined to price the
        // call — never defaulted to zero, which would sum silently.
        costUsd: body.usage?.cost ?? null,
        promptTokens: body.usage?.prompt_tokens ?? null,
        completionTokens: body.usage?.completion_tokens ?? null,
      },
    }
  }
}
