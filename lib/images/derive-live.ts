// lib/images/derive-live.ts — Prompt derivation against the story's own model.
// Server-only: this is the module that feeds the key into the SDK for the
// derivation call, and it is deliberately separate from the story's streaming
// core (lib/generation/openrouter.ts) because it is a different call, not a
// variation on one — different system prompt, reasoning turned off, and an
// answer that never reaches the manuscript.
import "server-only"

import { OpenRouterCore } from "@openrouter/sdk/core.js"
import { chatSend } from "@openrouter/sdk/funcs/chatSend.js"
import { EventStream } from "@openrouter/sdk/lib/event-streams.js"

import type { GenerationSettings } from "@/lib/types"

import { listModels } from "@/lib/generation/models"
import { reasoningParam } from "@/lib/generation/openrouter"
import type { ComposedContext } from "@/lib/generation/types"

/**
 * What the model is asked for.
 *
 * The rules exist because prose and image prompts fail in opposite directions.
 * A passage is mostly interiority, dialogue and named people; an image model
 * can draw none of those and will happily invent a face for a name it has never
 * seen. So: no names, physical description instead, and one visible moment
 * rather than a summary of the scene's meaning.
 *
 * "No style, no medium" is the load-bearing line. Art direction belongs to the
 * image profile, and a model left to its own devices appends "digital art,
 * trending on artstation" to everything — which would then be baked into the
 * prompt the writer edits, in a field that is supposed to hold only the scene.
 */
const SYSTEM_PROMPT = `You turn a scene from a story into a single image prompt.

Rules:
- Describe ONE visible moment: subjects, setting, time of day, light, weather, mood.
- Never use proper nouns. Describe people by appearance, age and dress instead.
- Only what a camera could see. No thoughts, no dialogue, no backstory, no plot.
- No art style, no medium, no artist names, no quality words.
- One or two sentences. Around 40 words, and never more than 70.
- No preamble, no quotes, no bullet list, no explanation of your choices.

Reply with the prompt and nothing else.`

/**
 * The user turn: the story as it currently stands, trimmed by the caller.
 *
 * Memory and lore ride along because a passage on its own routinely cannot say
 * what it looks like — "she stepped inside" names neither the woman nor the
 * room, and the lorebook is the only thing that does.
 */
export function renderDerivationPrompt(context: ComposedContext): string {
  const parts: string[] = []
  if (context.memory.trim() !== "") {
    parts.push(`Setting notes:\n${context.memory.trim()}`)
  }
  if (context.lore.length > 0) {
    parts.push(
      "Relevant details:\n" +
        context.lore
          .map((entry) => `- ${entry.name}: ${entry.content}`)
          .join("\n")
    )
  }
  parts.push(`Recent story:\n${context.storyText.trim()}`)
  parts.push(
    "Write the image prompt for the moment the story has just reached."
  )
  return parts.join("\n\n")
}

export interface DerivationEvent {
  type: "text" | "done"
  value?: string
  generationId?: string | null
  costUsd?: number | null
  promptTokens?: number | null
  completionTokens?: number | null
}

/**
 * Streams a derived image prompt.
 *
 * Runs at the story's model but NOT at the story's settings: thinking is forced
 * off, because a writer who set a reasoning model to "max" for their prose did
 * not ask to pay for deliberation over a caption.
 *
 * There is deliberately NO max_tokens. It used to be capped at 160, which broke
 * the feature in two directions at once. On a thinking model the reasoning
 * counts against the same budget, so the model could spend the entire cap
 * deliberating and return an empty string — a wand that silently did nothing.
 * And on any model a hard cap truncates mid-sentence, which is worse than a
 * long prompt: the writer gets something they have to repair rather than
 * something they can send. Length is the instruction's job now, which is where
 * it belongs — the model is being asked for one or two sentences, and a model
 * that cannot follow that is not one a token ceiling would have saved.
 *
 * The cost of being wrong is a fraction of a cent: even a model that ignored
 * the instruction entirely and wrote a thousand tokens would bill about $0.001.
 */
export async function* streamDerivation(opts: {
  context: ComposedContext
  settings: GenerationSettings
  key: string
  signal: AbortSignal
}): AsyncGenerator<DerivationEvent> {
  const { context, settings, key, signal } = opts
  const core = new OpenRouterCore({ apiKey: key, appTitle: "draft-zero" })

  // Cached in-process, so this is a lookup rather than a round trip. Needed
  // because "turn thinking off" is model-specific: a model that cannot reason
  // must not be sent the parameter at all, and one that reasons MANDATORILY
  // cannot be talked out of it — reasoningParam knows both rules, and this call
  // reuses it rather than restating them.
  const models = await listModels()
  const reasoning = reasoningParam(
    models.find((m) => m.id === settings.modelId),
    "off"
  )

  const res = await chatSend(
    core,
    {
      chatRequest: {
        model: settings.modelId,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: renderDerivationPrompt(context) },
        ],
        // The story's temperature is about prose voice. A description of what
        // is visibly in front of the reader wants to be accurate, not inventive,
        // so this one is fixed and low.
        temperature: 0.4,
        reasoning,
        stream: true,
      },
    },
    { signal }
  )
  if (!res.ok) throw res.error
  if (!(res.value instanceof EventStream)) {
    throw new Error("OpenRouter returned a non-streaming response")
  }

  let generationId: string | null = null
  let costUsd: number | null = null
  let promptTokens: number | null = null
  let completionTokens: number | null = null

  for await (const chunk of res.value) {
    if (signal.aborted) return
    if (chunk.error) {
      throw new Error(chunk.error.message ?? "Provider error mid-stream")
    }
    if (generationId === null && chunk.id) generationId = chunk.id

    const text = chunk.choices[0]?.delta.content
    if (typeof text === "string" && text !== "") {
      yield { type: "text", value: text }
    }
    if (chunk.usage) {
      costUsd = chunk.usage.cost ?? null
      promptTokens = chunk.usage.promptTokens
      completionTokens = chunk.usage.completionTokens
    }
  }

  yield {
    type: "done",
    generationId,
    costUsd,
    promptTokens,
    completionTokens,
  }
}
