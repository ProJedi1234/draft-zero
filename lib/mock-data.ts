// lib/mock-data.ts — Hardcoded fixture data for the static-scaffolding milestone.
// Nothing here persists; nothing here calls a network.

import { DEFAULT_CONTEXT_WINDOW, DEFAULT_LORE_BUDGET } from "./types"
import type {
  GenerationSettings,
  LorebookCategory,
  LorebookEntry,
  ModelEndpoint,
  OpenRouterImageModel,
  OpenRouterModel,
  Story,
  StoryEntry,
} from "./types"

/**
 * Wraps a fixture passage as "not a player action". Every entry below is
 * third-person literary prose written for the scaffolding, not something a
 * writer typed into the Say/Do composer, so all of them carry the null pair.
 * The helper exists so the fixtures still read as prose rather than as twelve
 * repetitions of two nulls.
 *
 * It fills the variant fields the same way the migration backfills real rows:
 * each fixture passage is a slot of its own holding exactly one take, so the
 * group id is the entry's own id and the count is 1. That keeps the fixtures
 * honest — a one-take slot renders no VariantSwitcher, which is what the
 * scaffolding has always shown. `generation` is null because no model produced
 * these; they were written by hand — and for the same reason they cost nothing
 * and have no ledger row, which is "unknown", not "$0.00".
 */
function proseEntry(
  entry: Omit<
    StoryEntry,
    | "actionKind"
    | "inputText"
    | "variantGroupId"
    | "variantIndex"
    | "variantCount"
    | "variantProfilesMixed"
    | "generation"
    | "costUsd"
    | "reasoningTokens"
    | "callStatus"
  >
): StoryEntry {
  return {
    ...entry,
    actionKind: null,
    inputText: null,
    variantGroupId: entry.id,
    variantIndex: 0,
    variantCount: 1,
    variantProfilesMixed: false,
    generation: null,
    costUsd: null,
    reasoningTokens: null,
    callStatus: null,
  }
}

// ---------------------------------------------------------------------------
// Models (OpenRouter stubs)
// ---------------------------------------------------------------------------

/**
 * The fallback catalog, written as OpenRouter's "~lab/family-latest" router
 * aliases rather than as pinned versions. A pinned id rots the moment the lab
 * ships a successor — and this list is what the picker shows when there is no
 * key, which is exactly when nobody is around to notice it has gone stale. The
 * aliases keep pointing at whatever is current, so `aliasTarget` below records
 * what each one redirected to when the fixture was written, not a promise.
 */
/**
 * The image catalog's offline fallback — real OpenRouter ids, the same
 * convention MOCK_MODELS follows for text. Prices live in MOCK_IMAGE_PRICES,
 * mirroring the live catalog, which does not carry them either.
 *
 * Kept short deliberately: it is a fallback for a picker, not a mirror of the
 * catalog, and a stale list of thirty entries would be thirty chances to offer
 * a model that no longer exists. These are the families the API documents.
 *
 * Note what selecting one of these does OFFLINE: nothing but change the seed.
 * The mock provider draws every picture itself (see lib/images/mock-provider.ts),
 * so the id is recorded as what was ASKED for, and the surfaces that show a
 * picture's provenance say when the offline provider served it instead.
 */
export const MOCK_IMAGE_MODELS: OpenRouterImageModel[] = [
  {
    id: "black-forest-labs/flux-1.1-pro",
    name: "FLUX 1.1 Pro",
    provider: "Black Forest Labs",
    zdr: false,
  },
  {
    id: "bytedance-seed/seedream-4.5",
    name: "Seedream 4.5",
    provider: "ByteDance",
    zdr: true,
  },
  {
    id: "google/gemini-3-pro-image",
    name: "Gemini 3 Pro Image",
    provider: "Google",
    zdr: true,
  },
  {
    id: "openai/gpt-image-1",
    name: "GPT Image 1",
    provider: "OpenAI",
    zdr: false,
  },
  {
    id: "recraft/recraft-v3",
    name: "Recraft V3",
    provider: "Recraft",
    zdr: false,
  },
  {
    id: "x-ai/grok-imagine",
    name: "Grok Imagine",
    provider: "xAI",
    zdr: false,
  },
]

/**
 * Offline prices for MOCK_IMAGE_MODELS, keyed by id.
 *
 * Separate from the catalog entries because live pricing is separate too: it
 * comes from a per-model endpoints resource, not from the list. Keeping the
 * shapes parallel means getImageModelPrice has one contract in both modes.
 */
export const MOCK_IMAGE_PRICES: Record<string, string> = {
  "black-forest-labs/flux-1.1-pro": "$0.0400 / image",
  "bytedance-seed/seedream-4.5": "$0.0300 / image",
  "google/gemini-3-pro-image": "$0.0600 / image",
  "openai/gpt-image-1": "$0.0800 / image",
  "recraft/recraft-v3": "$0.0400 / image",
  "x-ai/grok-imagine": "$0.0200 / image",
}

export const MOCK_MODELS: OpenRouterModel[] = [
  {
    id: "~anthropic/claude-sonnet-latest",
    name: "Claude Sonnet Latest",
    provider: "Anthropic",
    contextLength: 1_000_000,
    maxCompletionTokens: 65_536,
    pricing: { prompt: "$2.00", completion: "$10.00" },
    reasoning: {
      efforts: ["low", "medium", "high", "xhigh", "max"],
      mandatory: false,
    },
    zdr: true,
    aliasTarget: "anthropic/claude-sonnet-5",
  },
  {
    id: "~anthropic/claude-opus-latest",
    name: "Claude Opus Latest",
    provider: "Anthropic",
    contextLength: 1_000_000,
    maxCompletionTokens: 65_536,
    pricing: { prompt: "$5.00", completion: "$25.00" },
    reasoning: {
      efforts: ["low", "medium", "high", "xhigh", "max"],
      mandatory: false,
    },
    zdr: true,
    aliasTarget: "anthropic/claude-opus-5",
  },
  {
    id: "~anthropic/claude-haiku-latest",
    name: "Claude Haiku Latest",
    provider: "Anthropic",
    contextLength: 200_000,
    maxCompletionTokens: 65_536,
    pricing: { prompt: "$1.00", completion: "$5.00" },
    reasoning: {
      efforts: ["minimal", "low", "medium", "high", "xhigh", "max"],
      mandatory: false,
    },
    zdr: true,
    aliasTarget: "anthropic/claude-haiku-4.5",
  },
  {
    id: "~openai/gpt-latest",
    name: "GPT Latest",
    provider: "OpenAI",
    contextLength: 1_050_000,
    maxCompletionTokens: 65_536,
    pricing: { prompt: "$5.00", completion: "$30.00" },
    reasoning: {
      efforts: ["low", "medium", "high", "xhigh", "max"],
      mandatory: false,
    },
    zdr: true,
    aliasTarget: "openai/gpt-5.6-sol",
  },
  {
    id: "~openai/gpt-mini-latest",
    name: "GPT Mini Latest",
    provider: "OpenAI",
    contextLength: 400_000,
    maxCompletionTokens: 65_536,
    pricing: { prompt: "$0.75", completion: "$4.50" },
    reasoning: {
      efforts: ["low", "medium", "high", "xhigh"],
      mandatory: false,
    },
    zdr: true,
    aliasTarget: "openai/gpt-5.4-mini",
  },
  {
    id: "~google/gemini-pro-latest",
    name: "Gemini Pro Latest",
    provider: "Google",
    contextLength: 1_048_576,
    maxCompletionTokens: 65_536,
    pricing: { prompt: "$2.00", completion: "$12.00" },
    reasoning: { efforts: ["low", "medium", "high"], mandatory: true },
    zdr: true,
    aliasTarget: "google/gemini-3.1-pro-preview",
  },
  {
    id: "~google/gemini-flash-latest",
    name: "Gemini Flash Latest",
    provider: "Google",
    contextLength: 1_048_576,
    maxCompletionTokens: 65_536,
    pricing: { prompt: "$1.50", completion: "$7.50" },
    reasoning: {
      efforts: ["minimal", "low", "medium", "high"],
      mandatory: true,
    },
    zdr: true,
    aliasTarget: "google/gemini-3.6-flash",
  },
  {
    id: "~x-ai/grok-latest",
    name: "Grok Latest",
    provider: "xAI",
    contextLength: 500_000,
    maxCompletionTokens: 65_536,
    pricing: { prompt: "$2.00", completion: "$6.00" },
    reasoning: {
      efforts: ["low", "medium", "high", "xhigh"],
      mandatory: true,
    },
    zdr: true,
    aliasTarget: "x-ai/grok-4.6",
  },
  {
    id: "~moonshotai/kimi-latest",
    name: "Kimi Latest",
    provider: "MoonshotAI",
    contextLength: 1_048_576,
    maxCompletionTokens: 65_536,
    pricing: { prompt: "$2.80", completion: "$14.00" },
    reasoning: { efforts: ["low", "high", "max"], mandatory: false },
    zdr: false,
    aliasTarget: "moonshotai/kimi-k3",
  },
  {
    id: "~deepseek/deepseek-v4-flash-latest",
    name: "DeepSeek V4 Flash Latest",
    provider: "DeepSeek",
    contextLength: 1_048_576,
    maxCompletionTokens: 65_536,
    pricing: { prompt: "$0.08", completion: "$0.25" },
    reasoning: { efforts: ["low", "high", "max"], mandatory: false },
    zdr: false,
    aliasTarget: "deepseek/deepseek-v4-flash-0731",
  },
]

// ---------------------------------------------------------------------------
// Endpoints (provider-routing stubs)
// ---------------------------------------------------------------------------

/**
 * Stand-in upstream providers, roughly in the shape OpenRouter reports them:
 * `throughput` is a tokens/sec p50 and `priceFactor` scales the model's own
 * price, because the point of the picker is that these differ per endpoint.
 * The lab that made the weights is not in the pool — it always serves its own
 * models, so mockEndpoints() derives that entry from the model itself.
 */
const MOCK_ENDPOINT_POOL: ReadonlyArray<{
  tag: string
  providerName: string
  throughput: number | null
  uptime: number | null
  quantization: string | null
  priceFactor: number
  /** Whether this stand-in keeps nothing — mixed on purpose, as the real list is. */
  zdr: boolean
}> = [
  {
    tag: "groq",
    providerName: "Groq",
    throughput: 812,
    uptime: 0.998,
    quantization: "fp8",
    priceFactor: 0.9,
    zdr: true,
  },
  {
    tag: "cerebras",
    providerName: "Cerebras",
    throughput: 1_940,
    uptime: 0.991,
    quantization: "bf16",
    priceFactor: 1.1,
    zdr: true,
  },
  {
    tag: "fireworks",
    providerName: "Fireworks",
    throughput: 186,
    uptime: 0.999,
    quantization: "fp8",
    priceFactor: 0.95,
    zdr: true,
  },
  {
    tag: "deepinfra/turbo",
    providerName: "DeepInfra",
    throughput: 124,
    uptime: 0.984,
    quantization: "fp8",
    priceFactor: 0.6,
    zdr: false,
  },
  {
    tag: "together",
    providerName: "Together",
    throughput: 97,
    uptime: 0.996,
    quantization: "fp16",
    priceFactor: 1.05,
    zdr: true,
  },
  {
    tag: "novita",
    providerName: "Novita",
    throughput: null,
    uptime: null,
    quantization: null,
    priceFactor: 0.7,
    zdr: false,
  },
]

/** "$3.00" x 0.6 -> "$1.80". Display strings in, display string out. */
function scalePrice(price: string, factor: number): string {
  const n = Number(price.replace(/[^0-9.]/g, ""))
  if (!Number.isFinite(n)) return price
  return `$${(n * factor).toFixed(2)}`
}

/** Sum of char codes — enough to pick a stable pool slice per model id. */
function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1)
    hash = (hash + value.charCodeAt(i)) | 0
  return Math.abs(hash)
}

/**
 * Deterministic endpoint list for a model, used whenever the live catalog is
 * unavailable (no key, or the endpoints fetch failed) so the provider picker is
 * never empty and never differs between server and client render. The lab's own
 * endpoint is always first; two to four pool endpoints follow, chosen by a hash
 * of the model id so a given model always shows the same providers.
 */
export function mockEndpoints(model: OpenRouterModel): ModelEndpoint[] {
  const firstParty: ModelEndpoint = {
    // The alias "~" belongs to the id, not to the provider: OpenRouter's own
    // endpoint tags never carry it, so a mock endpoint must not either.
    tag: model.id.split("/")[0].replace(/^~/, ""),
    providerName: model.provider,
    contextLength: model.contextLength,
    pricing: model.pricing,
    throughput: 68 + (hashString(model.id) % 40),
    uptime: 0.997,
    quantization: null,
    // The lab's own endpoint retains nothing, which is true of most of the
    // first-party ones the real list carries.
    zdr: true,
  }
  const hash = hashString(model.id)
  const count = 2 + (hash % 3)
  const rest = Array.from({ length: count }, (_, i) => {
    const pooled = MOCK_ENDPOINT_POOL[(hash + i) % MOCK_ENDPOINT_POOL.length]
    return {
      tag: pooled.tag,
      providerName: pooled.providerName,
      // Third-party hosts commonly serve a shorter window than the lab does.
      contextLength: Math.min(model.contextLength, 131_072),
      pricing: {
        prompt: scalePrice(model.pricing.prompt, pooled.priceFactor),
        completion: scalePrice(model.pricing.completion, pooled.priceFactor),
      },
      throughput: pooled.throughput,
      uptime: pooled.uptime,
      quantization: pooled.quantization,
      zdr: pooled.zdr,
    }
  })
  // Closed models are single-source in reality; pretending Groq serves Claude
  // would make the mock actively misleading.
  return isClosedLab(model) ? [firstParty] : [firstParty, ...rest]
}

/** Labs that only serve their own weights, so their models have one endpoint. */
const CLOSED_MODEL_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "google",
  "x-ai",
  "xai",
])

/**
 * Whether the lab behind `model` serves it alone. Matched on both the display
 * provider and the model id's author, normalised, because the catalog's
 * provider name is only as good as the "Lab: Name" split it came from — an
 * entry named without the colon lands here as its bare author instead, and a
 * router alias wears a "~" in front of that author.
 */
function isClosedLab(model: OpenRouterModel): boolean {
  const normalise = (s: string) => s.replace(/^~/, "").toLowerCase()
  return (
    CLOSED_MODEL_PROVIDERS.has(normalise(model.provider)) ||
    CLOSED_MODEL_PROVIDERS.has(normalise(model.id.split("/")[0]))
  )
}

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  // The router alias, not a pinned version: a new story should start on
  // whatever Sonnet currently is, without a release turning this constant into
  // a slow drift toward an older model.
  modelId: "~anthropic/claude-sonnet-latest",
  thinking: "off",
  // Auto — OpenRouter picks the endpoint. Pinning one in the defaults would
  // pin it for every new story, including stories on other models.
  providerTag: null,
  // Off, and asked for rather than assumed: zero data retention costs a writer
  // providers (and sometimes the model they wanted), so it is a choice the
  // writer makes in Settings, not one a new story arrives holding.
  zdr: false,
  temperature: 0.9,
  topP: 0.95,
  // The share the lorebook may claim of the free context — what the old
  // hard-coded constant was, so a new story composes as stories always have.
  loreBudget: DEFAULT_LORE_BUDGET,
  // Roughly 30k characters of assembled context: enough for memory, the active
  // lore and several pages of recent prose without making every continuation
  // an expensive re-read of the whole draft.
  contextWindow: DEFAULT_CONTEXT_WINDOW,
  frequencyPenalty: 0.15,
  presencePenalty: 0.1,
}

// ---------------------------------------------------------------------------
// Lorebook — every fixture entry belongs to the Cartographer draft. Lore is
// scoped per story, so the other seeded stories start with an empty lorebook.
// ---------------------------------------------------------------------------

export const MOCK_LOREBOOK_ENTRIES: LorebookEntry[] = [
  {
    id: "lore-char-maren",
    storyId: "story-cartographer",
    name: "Maren Kestrel",
    category: "character",
    keys: ["Maren", "Kestrel", "the cartographer"],
    content:
      "Maren Kestrel, 34, is a licensed surveyor of the Graywater floodplain and an unlicensed cartographer of things that should not be mapped. Sharp-tongued, methodical, quietly terrified of open water. She owes the river god Elathe eleven maps' worth of debt and has never told the Guild why her surveys are always accurate.",
    enabled: true,
    alwaysActive: false,
    priority: 80,
    createdAt: "2026-06-02T09:00:00Z",
    updatedAt: "2026-08-01T17:20:00Z",
  },
  {
    id: "lore-char-oswin",
    storyId: "story-cartographer",
    name: "Oswin Pyke",
    category: "character",
    keys: ["Oswin", "Pyke", "ferryman"],
    content:
      "Oswin Pyke runs the last ferry across Graywater Crossing. Cheerful, missing two fingers, superstitious in the practical way of people who work on haunted water. He leaves a copper coin on the tiller for Elathe every crossing and pretends it is habit rather than payment.",
    enabled: true,
    alwaysActive: false,
    priority: 55,
    createdAt: "2026-06-02T09:15:00Z",
    updatedAt: "2026-07-18T11:05:00Z",
  },
  {
    id: "lore-char-elathe",
    storyId: "story-cartographer",
    name: "Elathe, the Ithren",
    category: "character",
    keys: ["Elathe", "river god", "the Ithren", "the river"],
    content:
      "Elathe is the god of the river Ithren: patient, contractual, and literal. It speaks through the water's surface and collects debts in maps, memories, and names. It cannot lie, but it curates truth ruthlessly. It considers Maren its finest investment.",
    enabled: true,
    alwaysActive: true,
    priority: 95,
    createdAt: "2026-06-02T09:30:00Z",
    updatedAt: "2026-08-05T08:40:00Z",
  },
  {
    id: "lore-loc-graywater",
    storyId: "story-cartographer",
    name: "Graywater Crossing",
    category: "location",
    keys: ["Graywater", "the Crossing"],
    content:
      "A stone causeway where the Ithren bends against its own current. The drowned quarter of the old city lies beneath it, visible on still mornings. Compasses fail here; the Guild marks it on official maps with a decorative flourish instead of soundings.",
    enabled: true,
    alwaysActive: false,
    priority: 70,
    createdAt: "2026-06-03T10:00:00Z",
    updatedAt: "2026-07-30T14:00:00Z",
  },
  {
    id: "lore-loc-saltmarket",
    storyId: "story-cartographer",
    name: "The Salt Market",
    category: "location",
    keys: ["Salt Market", "saltmarket"],
    content:
      "A covered market on the east bank where smugglers sell 'unmapped goods' — items that officially do not exist because no chart admits the places they came from. The Guild raids it quarterly, ceremonially, and finds nothing.",
    enabled: true,
    alwaysActive: false,
    priority: 40,
    createdAt: "2026-06-05T12:00:00Z",
    updatedAt: "2026-06-28T16:30:00Z",
  },
  {
    id: "lore-loc-undermap",
    storyId: "story-cartographer",
    name: "The Undermap Archive",
    category: "location",
    keys: ["Undermap", "archive"],
    content:
      "The Guild's sealed basement archive of withdrawn maps — charts that proved too true. Shelved in lead-lined cases, indexed by the disasters they predicted. Maren has been inside twice, once with permission.",
    enabled: true,
    alwaysActive: false,
    priority: 60,
    createdAt: "2026-06-10T09:00:00Z",
    updatedAt: "2026-07-02T10:10:00Z",
  },
  {
    id: "lore-faction-guild",
    storyId: "story-cartographer",
    name: "The Surveyors' Guild",
    category: "faction",
    keys: ["Guild", "surveyors"],
    content:
      "The licensing body for all cartography in the river provinces. Publicly a professional association; privately a containment agency that decides which places may be drawn. Guild law: 'A map is a promise. Do not promise carelessly.'",
    enabled: true,
    alwaysActive: false,
    priority: 65,
    createdAt: "2026-06-03T11:00:00Z",
    updatedAt: "2026-07-25T09:45:00Z",
  },
  {
    id: "lore-faction-drowned",
    storyId: "story-cartographer",
    name: "Court of the Drowned",
    category: "faction",
    keys: ["Drowned", "the Court"],
    content:
      "The dead of the sunken quarter, who still hold municipal grudges and, arguably, municipal office. They petition Elathe for the return of their streets. Currently disabled while their role in act two is rethought.",
    enabled: false,
    alwaysActive: false,
    priority: 30,
    createdAt: "2026-06-12T15:00:00Z",
    updatedAt: "2026-07-12T15:00:00Z",
  },
  {
    id: "lore-item-needle",
    storyId: "story-cartographer",
    name: "The Bone Needle",
    category: "item",
    keys: ["bone needle", "needle", "compass"],
    content:
      "A compass needle carved from the wing-bone of a river heron. It does not point north; it points toward whatever the Ithren wants found. Warm to the touch when the river is watching. Maren keeps it wrapped in oilcloth and lies to herself about why.",
    enabled: true,
    alwaysActive: false,
    priority: 75,
    createdAt: "2026-06-04T08:00:00Z",
    updatedAt: "2026-08-03T19:00:00Z",
  },
  {
    id: "lore-event-flood",
    storyId: "story-cartographer",
    name: "The Third Flood",
    category: "event",
    keys: ["Third Flood", "the flood"],
    content:
      "Forty years ago the Ithren rose without rain and took the lower city in a night. Official history calls it a natural disaster. The Guild's withdrawn charts, shelved in the Undermap, show the flood line drawn in ink dated three days before the water came.",
    enabled: true,
    alwaysActive: false,
    priority: 50,
    createdAt: "2026-06-06T10:00:00Z",
    updatedAt: "2026-07-08T13:20:00Z",
  },
  {
    id: "lore-concept-debt",
    storyId: "story-cartographer",
    name: "Cartographer's Debt",
    category: "concept",
    keys: ["debt", "twelfth map", "payment"],
    content:
      "Maps drawn with Elathe's help come true — and each one is a loan. The debt is repaid in maps the river commissions, and the river's commissions are never innocent. Maren owes one final map: the twelfth, a chart of the drowned quarter as it was the night it sank.",
    enabled: true,
    alwaysActive: true,
    priority: 90,
    createdAt: "2026-06-02T09:45:00Z",
    updatedAt: "2026-08-06T21:00:00Z",
  },

  // ---------------------------------------------------------------------------
  // "Signal from the Hollow Deck" — the lorebook v2 demonstration set.
  //
  // Every entry below is placed to exercise one activation path, so the
  // inspector's Lore segment reads as a map of the feature:
  //   · Standing Orders  — always on
  //   · Meridian, Vaharan — triggered by MEMORY (stable)
  //   · The Compact      — triggered by the AUTHOR'S NOTE (stable)
  //   · Reactor Core     — triggered by the STORY window (volatile)
  //   · Ninth Rotation → Hollow Deck → Cassiel Yun — a three-deep CASCADE
  //   · The Sleepers     — one hop past the cap, so it stays out
  //   · Port Ellis       — nothing mentions it, so it never activates
  {
    id: "lore-mer-orders",
    storyId: "story-meridian",
    name: "Standing Orders",
    category: "concept",
    keys: [],
    content:
      "Standing orders, unchanged since departure: the ship does not decelerate without a unanimous waking vote. No compartment is opened against pressure. No sealed order is read before its stated hour. An officer who breaks one of these is relieved, not punished — the distinction matters to the people who wrote them.",
    enabled: true,
    alwaysActive: true,
    priority: 90,
    createdAt: "2026-08-18T09:00:00Z",
    updatedAt: "2026-08-18T09:00:00Z",
  },
  {
    id: "lore-mer-captain",
    storyId: "story-meridian",
    name: "Ines Vaharan",
    category: "character",
    keys: ["Ines", "Vaharan", "the captain"],
    content:
      "Captain Ines Vaharan has held command since the Ninth Rotation. She is sixty-one, unsentimental, and keeps the last sealed order in a drawer she does not lock. Twice she has been asked to open it early. Twice she has declined, and both times gave the same reason: that the hour was stated.",
    enabled: true,
    alwaysActive: false,
    priority: 80,
    createdAt: "2026-08-18T09:01:00Z",
    updatedAt: "2026-08-18T09:01:00Z",
  },
  {
    id: "lore-mer-ship",
    storyId: "story-meridian",
    name: "Meridian Ascending",
    category: "location",
    keys: ["Meridian", "the ship"],
    content:
      "A generation ship two hundred and six years out from Sol, carrying nine thousand colonists in cold storage and a waking crew of four hundred. Her hull is a cylinder eleven kilometres long that turns once a minute for weight. Her authority is the Compact, and it ends where the Compact ends.",
    enabled: true,
    alwaysActive: false,
    priority: 75,
    createdAt: "2026-08-18T09:02:00Z",
    updatedAt: "2026-08-18T09:02:00Z",
  },
  {
    id: "lore-mer-compact",
    storyId: "story-meridian",
    name: "The Compact",
    category: "faction",
    keys: ["Compact"],
    content:
      "The ship's founding law, written planetside before departure and amendable only by unanimous waking vote. It defines who may be woken, and when, and on whose authority. It is silent on what is owed to a crew that arrives early, because the people who drafted it could not imagine arriving at all.",
    enabled: true,
    alwaysActive: false,
    priority: 70,
    createdAt: "2026-08-18T09:03:00Z",
    updatedAt: "2026-08-18T09:03:00Z",
  },
  {
    id: "lore-mer-reactor",
    storyId: "story-meridian",
    name: "Reactor Core",
    category: "item",
    keys: ["reactor"],
    content:
      "The primary reactor has run at eighty-one percent since the Ninth Rotation and no engineer alive has seen it higher. Its containment is held by the Tannhauser Seal, which is checked every watch and has never once been found wanting.",
    enabled: true,
    alwaysActive: false,
    priority: 65,
    createdAt: "2026-08-18T09:04:00Z",
    updatedAt: "2026-08-18T09:04:00Z",
  },
  {
    id: "lore-mer-ninth",
    storyId: "story-meridian",
    name: "The Ninth Rotation",
    category: "event",
    keys: ["Ninth Rotation"],
    content:
      "The year the corridors below frame ninety were sealed, evacuated and renamed the Hollow Deck. The minutes of the vote survive in full. The tally does not, and no one who was present has ever been willing to reconstruct it from memory.",
    enabled: true,
    alwaysActive: false,
    priority: 60,
    createdAt: "2026-08-18T09:05:00Z",
    updatedAt: "2026-08-18T09:05:00Z",
  },
  {
    id: "lore-mer-hollow",
    storyId: "story-meridian",
    name: "Hollow Deck",
    category: "location",
    keys: ["Hollow Deck"],
    content:
      "Eleven compartments below frame ninety, unpressurised and dark since the Ninth Rotation. The bulkhead lights still cycle on the old schedule. The last name in the access log, signed the night the deck was sealed, is Cassiel Yun.",
    enabled: true,
    alwaysActive: false,
    priority: 55,
    createdAt: "2026-08-18T09:06:00Z",
    updatedAt: "2026-08-18T09:06:00Z",
  },
  {
    id: "lore-mer-cassiel",
    storyId: "story-meridian",
    name: "Cassiel Yun",
    category: "character",
    keys: ["Cassiel", "Yun"],
    content:
      "Chief of hull integrity through the Ninth Rotation, listed in the manifest as neither waking nor sleeping. Her authorisation still opens doors it should not. The Sleepers' registry has no entry under her name, and the omission is too tidy to be clerical.",
    enabled: true,
    alwaysActive: false,
    priority: 50,
    createdAt: "2026-08-18T09:07:00Z",
    updatedAt: "2026-08-18T09:07:00Z",
  },
  {
    id: "lore-mer-sleepers",
    storyId: "story-meridian",
    name: "The Sleepers",
    category: "faction",
    keys: ["Sleepers"],
    content:
      "Nine thousand colonists in cold storage, ordered by the lottery that selected them. They have no vote under the Compact until they are woken, which is the whole of the argument that has run for two centuries.",
    enabled: true,
    alwaysActive: false,
    priority: 45,
    createdAt: "2026-08-18T09:08:00Z",
    updatedAt: "2026-08-18T09:08:00Z",
  },
  {
    id: "lore-mer-seal",
    storyId: "story-meridian",
    name: "Tannhauser Seal",
    category: "item",
    keys: ["Tannhauser"],
    content:
      "A single-use magnetic closure rated for the life of the ship. Once broken it cannot be reset without a shipwright's authority, and there has been no shipwright aboard since the second generation died.",
    enabled: true,
    alwaysActive: false,
    priority: 40,
    createdAt: "2026-08-18T09:09:00Z",
    updatedAt: "2026-08-18T09:09:00Z",
  },
  {
    id: "lore-mer-portellis",
    storyId: "story-meridian",
    name: "Port Ellis",
    category: "location",
    keys: ["Port Ellis", "Ellis Station"],
    content:
      "The last waystation before the long dark, and the last place anyone aboard drew a breath of air they had not made themselves. Nothing in this story has mentioned it yet — which is why it is not in context.",
    enabled: true,
    alwaysActive: false,
    priority: 30,
    createdAt: "2026-08-18T09:10:00Z",
    updatedAt: "2026-08-18T09:10:00Z",
  },
]

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

export const MOCK_STORIES: Story[] = [
  {
    id: "story-cartographer",
    title: "The Cartographer's Debt",
    tintHue: 200,
    tintStrength: 0.85,
    tintAuto: false,
    description:
      "A surveyor who draws maps that come true owes one last chart to the river god that taught her how.",
    genre: "Fantasy",
    createdAt: "2026-06-02T08:30:00Z",
    updatedAt: "2026-08-09T21:15:00Z",
    wordCount: 436,
    memory:
      "Maren Kestrel is a Guild-licensed surveyor whose maps come true because the river god Elathe guides her hand. She owes Elathe a twelfth and final map: the drowned quarter as it was the night it sank. Tone: literary fantasy, wry, melancholy. Third person past, close on Maren.",
    systemPrompt: null,
    summary: "",
    summarize: true,
    authorsNote:
      "Keep the river's dialogue literal and contractual. Never let Elathe lie.",
    activeLorebookEntryIds: [
      "lore-char-maren",
      "lore-char-elathe",
      "lore-loc-graywater",
      "lore-item-needle",
      "lore-concept-debt",
    ],
    // The fixtures carry no op journal — they were never produced by turns the
    // writer could reverse — so undo and redo are both dead here, and the
    // summaries are null rather than invented labels for ops that do not exist.
    canUndo: false,
    canRedo: false,
    undoSummary: null,
    redoSummary: null,
    profileId: null,
    settings: {
      modelId: "~anthropic/claude-sonnet-latest",
      thinking: "off",
      providerTag: null,
      zdr: false,
      temperature: 0.9,
      topP: 0.95,
      loreBudget: DEFAULT_LORE_BUDGET,
      contextWindow: 16384,
      frequencyPenalty: 0.15,
      presencePenalty: 0.1,
    },
    images: [],
    imageModelId: null,
    entries: [
      proseEntry({
        id: "entry-cart-1",
        source: "generated",
        createdAt: "2026-06-02T08:45:00Z",
        text: 'The river had been lying to maps for three hundred years, and Maren Kestrel was the first cartographer honest enough to write the lies down. She stood on the stone lip of Graywater Crossing with her drafting board strapped to her chest, watching the Ithren bend a way no river should bend — uphill, against its own current, toward the drowned quarter of the old city.\n\nHer Guild license said she surveyed floodplains. Her private ledger said something truer: eleven maps drawn, eleven debts accrued, one river god growing impatient.\n\n"You\'re late," said the water.',
      }),
      proseEntry({
        id: "entry-cart-2",
        source: "user",
        createdAt: "2026-06-02T09:10:00Z",
        text: 'Maren set down her board and unwrapped the bone needle from its oilcloth. It swung once, twice, and settled — pointing not north but down, through the causeway stone, toward whatever the Ithren kept beneath the crossing. "I brought your payment," she said, and hated how small her voice sounded over the water.',
      }),
      proseEntry({
        id: "entry-cart-3",
        source: "generated",
        createdAt: "2026-06-02T09:12:00Z",
        text: 'The current folded in on itself, and out of the fold rose a shape that was mostly suggestion: a figure of green glass water, tall as a mast, wearing the surface of the river like a borrowed coat. Elathe did not have a face. It had, instead, a place where attention gathered, and all of it gathered now on the oilcloth in her hands.\n\n"Payment," the god repeated, in a voice like a lock turning. "You use that word the way drowning men use the word \'swimming.\' Show me the twelfth map, Maren Kestrel."',
      }),
      proseEntry({
        id: "entry-cart-4",
        source: "user",
        createdAt: "2026-06-02T09:30:00Z",
        text: "\"It isn't finished.\" The lie came out smooth, practiced. The map was finished. It had been finished for a month, rolled inside her chimney where the damp couldn't reach, and every night since she had dreamed of the streets it showed — streets full of people who did not yet know they were about to be dead.",
      }),
      proseEntry({
        id: "entry-cart-5",
        source: "generated",
        createdAt: "2026-06-02T09:32:00Z",
        text: 'The river went still. Not calm — still, the way a courtroom goes still. Along the whole length of the crossing the water stopped moving, and in that stillness Maren could see straight down through forty feet of green light to the drowned quarter: slate roofs furred with weed, a bell tower, a market square where pale shapes drifted between the stalls in an unhurried parody of errands.\n\n"Cartographer," Elathe said softly, "I taught you to draw true things. I did not teach you to say false ones. We will both pretend that mercy is why I let that pass."',
      }),
    ],
  },
  {
    id: "story-static",
    title: "Static Between Stars",
    tintHue: 255,
    tintStrength: 0.85,
    tintAuto: false,
    description:
      "A salvage crew answers a distress call from a colony ship that went silent sixty years ago — and finds the broadcast is still being made.",
    genre: "Science Fiction",
    createdAt: "2026-07-14T19:00:00Z",
    updatedAt: "2026-08-07T23:40:00Z",
    wordCount: 328,
    memory:
      "The salvage tug Magpie (crew: Ade Osei, pilot; Rhys, engineer; the narrator, comms) has intercepted a distress loop from the colony ship Meridian, lost 60 years ago. The loop's timestamp updates every day. Tone: quiet dread, hard-SF texture. First person present.",
    systemPrompt: null,
    summary: "",
    summarize: true,
    authorsNote:
      "Slow burn. Horror through procedure and radio protocol, not gore.",
    activeLorebookEntryIds: [],
    canUndo: false,
    canRedo: false,
    undoSummary: null,
    redoSummary: null,
    profileId: null,
    settings: {
      modelId: "~openai/gpt-latest",
      thinking: "off",
      providerTag: null,
      zdr: false,
      temperature: 1.1,
      topP: 0.9,
      loreBudget: DEFAULT_LORE_BUDGET,
      contextWindow: 8192,
      frequencyPenalty: 0.3,
      presencePenalty: 0.2,
    },
    images: [],
    imageModelId: null,
    entries: [
      proseEntry({
        id: "entry-static-1",
        source: "generated",
        createdAt: "2026-07-14T19:20:00Z",
        text: "The distress call is sixty years old and four hours new. I keep both facts on my screen because one of them has to be wrong, and so far neither of them will admit it.\n\nMagpie hangs at station-keeping two thousand klicks off the Meridian's hull, close enough that our floodlights catch the colony ship's name in flaking paint. Every twenty-six hours her transmitter wakes, sends the same forty-one seconds of audio, and stamps it with the current date. Ships do not do that. Dead ships especially do not do that.",
      }),
      proseEntry({
        id: "entry-static-2",
        source: "user",
        createdAt: "2026-07-15T08:05:00Z",
        text: "Ade wants to board her. Rhys wants to log the contact and burn for home, and for once I think the engineer has the better physics. But salvage law is salvage law: first crew to make hull contact owns the claim, and the Meridian is the richest wreck in three systems.\n\nI put the forty-one seconds on the cabin speakers one more time.",
      }),
      proseEntry({
        id: "entry-static-3",
        source: "generated",
        createdAt: "2026-07-15T08:07:00Z",
        text: "It opens with the standard header, a woman's voice, calm the way only trained voices are calm: 'Colony vessel Meridian, requesting immediate assistance, one-one-eight souls aboard.' Then eleven seconds of station noise — air handlers, a child asking something far from the mic — and then the part I do not play for the others anymore.\n\nThe voice comes back. It is the same voice, but it has stopped being calm, and it says: 'Correction. One-one-nine souls aboard. Correction. One-two-zero.'\n\nThe count has gone up in every broadcast since we arrived.",
      }),
      proseEntry({
        id: "entry-static-4",
        source: "user",
        createdAt: "2026-07-16T22:00:00Z",
        text: "I flag the anomaly in the contact log, encrypt it, and do not tell Ade about the newest number. One hundred twenty-three. We are three people on this tug, and I have stopped believing in coincidence.",
      }),
    ],
  },
  {
    id: "story-lighthouse",
    title: "The Lighthouse at Wren Point",
    tintHue: 60,
    tintStrength: 1,
    tintAuto: false,
    description:
      "A grief-struck keeper takes the winter posting at a lighthouse whose last three keepers all resigned on the same date.",
    genre: "Mystery",
    createdAt: "2026-05-20T10:00:00Z",
    updatedAt: "2026-07-28T09:30:00Z",
    wordCount: 243,
    memory:
      "Esther Hale, recently widowed, has taken the winter keeper's post at Wren Point light. The previous three keepers each resigned on the 14th of February. The Trust's logbooks for that date are razored out. Tone: gothic, restrained. First person past, epistolary logbook entries.",
    systemPrompt: null,
    summary: "",
    summarize: true,
    authorsNote:
      "Every scene should be explainable two ways until the final act.",
    activeLorebookEntryIds: [],
    canUndo: false,
    canRedo: false,
    undoSummary: null,
    redoSummary: null,
    profileId: null,
    settings: {
      modelId: "~anthropic/claude-opus-latest",
      thinking: "off",
      providerTag: null,
      zdr: false,
      temperature: 0.8,
      topP: 0.98,
      loreBudget: DEFAULT_LORE_BUDGET,
      contextWindow: 12288,
      frequencyPenalty: 0.1,
      presencePenalty: 0.05,
    },
    images: [],
    imageModelId: null,
    entries: [
      proseEntry({
        id: "entry-light-1",
        source: "user",
        createdAt: "2026-05-20T10:30:00Z",
        text: "Log of the keeper, Wren Point Light. 3rd November.\n\nThe Trust's launch left me at the landing at noon with four months of tinned goods, a crate of lamp oil, and the strong impression that the boatman did not intend to cut the engine while I unloaded. The tower is sound. The light is sound. The logbook they gave me is new, which I thought nothing of until I found the old ones in the store room — nine volumes, complete, except that in each of them the same week of February has been cut out with a razor.",
      }),
      proseEntry({
        id: "entry-light-2",
        source: "generated",
        createdAt: "2026-05-20T10:33:00Z",
        text: "4th November.\n\nWind northwest, moderate. Lamp lit at 4:12, extinguished at 7:40. I record these details because the Trust requires them and because there is a comfort in requirements.\n\nOne matter I will set down plainly, since no one reads this but the Trust and the Trust does not read it either: the light was already warm when I climbed to light it. Not burning — warm. The brass of the lamp housing held heat the way a chair holds the shape of someone who has just stood up. I have decided to attribute it to the sun through the lens room glass, and I record here, honestly, that the sky was overcast all day.",
      }),
      proseEntry({
        id: "entry-light-3",
        source: "user",
        createdAt: "2026-05-21T09:00:00Z",
        text: "6th November.\n\nI have begun taking my supper in the lens room. Edward would have laughed at me — dining at the top of ninety-eight stairs for the company of a lamp. But the kitchen has a window that faces the sea, and the sea at dusk has started to look to me like it is standing very still on purpose.",
      }),
    ],
  },
  {
    id: "story-untitled",
    title: "Untitled Story",
    tintHue: null,
    tintStrength: 1,
    tintAuto: true,
    description: "A brand-new draft. Nothing written yet.",
    genre: "Unsorted",
    createdAt: "2026-08-10T07:00:00Z",
    updatedAt: "2026-08-10T07:00:00Z",
    wordCount: 0,
    memory: "",
    systemPrompt: null,
    summary: "",
    summarize: true,
    authorsNote: "",
    activeLorebookEntryIds: [],
    canUndo: false,
    canRedo: false,
    undoSummary: null,
    redoSummary: null,
    profileId: null,
    settings: { ...DEFAULT_GENERATION_SETTINGS },
    images: [],
    imageModelId: null,
    entries: [],
  },

  {
    id: "story-meridian",
    title: "Signal from the Hollow Deck",
    tintHue: 25,
    tintStrength: 1,
    tintAuto: false,
    description:
      "Two centuries into the crossing, a sealed deck answers a hail nobody sent.",
    genre: "Science fiction",
    createdAt: "2026-08-18T09:00:00Z",
    updatedAt: "2026-08-18T10:30:00Z",
    wordCount: 512,
    // Names Vaharan and the Meridian and nothing else: both entries are then
    // held in context by the memory rather than by the prose, which is what
    // puts them in the prompt's cacheable head.
    memory:
      "The generation ship Meridian Ascending is two hundred and six years out from Sol. Captain Ines Vaharan holds the last sealed order and has not opened it. Tone: cold, procedural, elegiac. Third person past, close on Vaharan.",
    systemPrompt: null,
    summary: "",
    summarize: true,
    // "Compact" appears here and nowhere else, so The Compact is a lore entry
    // the AUTHOR'S NOTE pulls into context — stable, like the memory's two.
    authorsNote:
      "Keep the Compact's language legal and exact. No officer speaks in slogans.",
    // Recomputed at read time by real trigger matching; the value here is only
    // what the client-side mock renders before the first read.
    activeLorebookEntryIds: [
      "lore-mer-orders",
      "lore-mer-captain",
      "lore-mer-ship",
      "lore-mer-compact",
      "lore-mer-reactor",
      "lore-mer-ninth",
      "lore-mer-hollow",
      "lore-mer-cassiel",
      "lore-mer-seal",
    ],
    canUndo: false,
    canRedo: false,
    undoSummary: null,
    redoSummary: null,
    profileId: null,
    settings: {
      modelId: "~anthropic/claude-sonnet-latest",
      thinking: "off",
      providerTag: null,
      zdr: false,
      temperature: 0.9,
      topP: 0.95,
      loreBudget: DEFAULT_LORE_BUDGET,
      contextWindow: 8192,
      frequencyPenalty: 0.15,
      presencePenalty: 0.1,
    },
    images: [],
    imageModelId: null,
    entries: [
      proseEntry({
        id: "entry-mer-1",
        source: "generated",
        createdAt: "2026-08-18T09:20:00Z",
        text: "The hail came in on a channel that had been dead for a hundred and ninety years, and it came in clean. No carrier drift, no decay, no apology of static at the edges. It simply arrived, the way a knock arrives, and the watch officer who logged it wrote down the time and then sat looking at what he had written.",
      }),
      proseEntry({
        id: "entry-mer-2",
        source: "generated",
        createdAt: "2026-08-18T09:32:00Z",
        text: "Vaharan was awake before they reached her door. She had been awake for most of an hour, for no reason she could name, and afterward she would decide not to mention that part to anyone. She read the log entry twice. Then she asked the question that mattered, which was not what the signal said but where it had been sent from.",
      }),
      proseEntry({
        id: "entry-mer-3",
        source: "generated",
        createdAt: "2026-08-18T09:44:00Z",
        text: "Below frame ninety, the officer said, and did not elaborate, because there was nothing below frame ninety and everyone in the room had grown up knowing it. The corridors there had been sealed before their grandparents drew breath. The lights still ran on the old schedule, cycling dawn and dusk for eleven compartments of vacuum.",
      }),
      proseEntry({
        id: "entry-mer-4",
        source: "generated",
        createdAt: "2026-08-18T09:58:00Z",
        text: "She went to the drawer and looked at the sealed order without touching it. The hour stated on its face was four years away. She closed the drawer. Whatever was speaking from a dead deck could wait the length of time it took her to do this properly, and if it could not, then it was not what it claimed to be.",
      }),
      proseEntry({
        id: "entry-mer-5",
        source: "generated",
        createdAt: "2026-08-18T10:11:00Z",
        text: "The engineering watch reported nothing anomalous, which was itself the anomaly. The reactor held at eighty-one percent, as it had every hour of her command and every hour of the command before hers. She asked for the containment figures anyway and read them line by line, and they were the figures they had always been.",
      }),
      proseEntry({
        id: "entry-mer-6",
        source: "generated",
        createdAt: "2026-08-18T10:24:00Z",
        text: "By the second watch the signal had repeated four times, always the same length, always beginning on the minute. It carried no words that the decoders would admit to. But it had a shape, and the shape was the cadence of someone reading aloud from a document — the pauses falling where a clause would end.",
      }),
    ],
  },
]

export const DEFAULT_STORY_ID = "story-cartographer"

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function getStoryById(id: string): Story | undefined {
  return MOCK_STORIES.find((s) => s.id === id)
}

export function getModelById(id: string): OpenRouterModel | undefined {
  return MOCK_MODELS.find((m) => m.id === id)
}

export function getLorebookEntryById(id: string): LorebookEntry | undefined {
  return MOCK_LOREBOOK_ENTRIES.find((e) => e.id === id)
}

/** Enabled lorebook entries referenced by the story, in lorebook order. */
export function getActiveLorebookEntries(story: Story): LorebookEntry[] {
  return MOCK_LOREBOOK_ENTRIES.filter(
    (e) => e.enabled && story.activeLorebookEntryIds.includes(e.id)
  )
}

/** All entries (enabled and disabled) for a category, or all entries for "all". */
export function getLorebookEntriesByCategory(
  category: LorebookCategory | "all"
): LorebookEntry[] {
  if (category === "all") return MOCK_LOREBOOK_ENTRIES
  return MOCK_LOREBOOK_ENTRIES.filter((e) => e.category === category)
}
