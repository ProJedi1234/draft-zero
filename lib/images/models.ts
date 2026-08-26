// lib/images/models.ts — Live OpenRouter image catalog, server-only.
// The sibling of lib/generation/models.ts, and deliberately a separate module:
// image models come from a different endpoint, carry different fields, and the
// two lists must never be mixed — a text model in the image picker would be
// selectable and then fail at generation time.
import "server-only"

import { MOCK_IMAGE_MODELS, MOCK_IMAGE_PRICES } from "@/lib/mock-data"
import type { OpenRouterImageModel } from "@/lib/types"

import { getAppSettings } from "@/lib/db/queries"
import { resolveOpenRouterKey } from "@/lib/generation/key"
import { zdrModelSlugs } from "@/lib/generation/zdr"

const TTL_MS = 60 * 60 * 1000
let cache: { at: number; data: OpenRouterImageModel[] } | null = null

const ENDPOINT = "https://openrouter.ai/api/v1/images/models"

/**
 * The shape we read out of the catalog.
 *
 * Hand-written rather than taken from the SDK: the image endpoints are newer
 * than the SDK surface this project pins, so this is a plain fetch and the
 * response is narrowed here. Everything is optional because a catalog we do not
 * control is allowed to add and rename fields without breaking the picker.
 *
 * Note what is NOT here: pricing. The list endpoint carries none — an entry's
 * `endpoints` is a URL string, and the cost per image is behind it.
 */
interface RawImageModel {
  id?: unknown
  name?: unknown
}

function toDomain(
  raw: RawImageModel,
  zdrSlugs: Set<string>
): OpenRouterImageModel | null {
  if (typeof raw.id !== "string" || raw.id === "") return null
  const name =
    typeof raw.name === "string" && raw.name !== "" ? raw.name : raw.id
  // Same "Provider: Model" convention the text catalog uses, with the id's
  // author as the fallback for entries named without the colon.
  const [provider, ...rest] = name.split(": ")
  return {
    id: raw.id,
    name: rest.length > 0 ? rest.join(": ") : name,
    provider:
      rest.length > 0 ? provider : raw.id.split("/")[0].replace(/^~/, ""),
    // The global ZDR endpoint list covers image endpoints too — verified
    // against the live catalog, where 12 of 48 image models appear on it.
    zdr: zdrSlugs.has(raw.id),
  }
}

/**
 * The image catalog, cached an hour per server process.
 *
 * Falls back to MOCK_IMAGE_MODELS when unconfigured or when the fetch fails —
 * the picker must never be empty, for the same reason the model picker mustn't:
 * an empty combobox reads as a broken app rather than as a missing key.
 */
export async function listImageModels(): Promise<OpenRouterImageModel[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data
  const key = resolveOpenRouterKey()
  if (!key) return MOCK_IMAGE_MODELS
  try {
    // The ZDR join rides the same fetch: zdrModelSlugs is the hour-cached
    // global list the text catalog already reads, so this is one extra lookup,
    // not one extra round trip per refresh.
    const [res, zdrSlugs] = await Promise.all([
      fetch(ENDPOINT, { headers: { Authorization: `Bearer ${key}` } }),
      zdrModelSlugs(),
    ])
    if (!res.ok) return MOCK_IMAGE_MODELS
    const body = (await res.json()) as { data?: RawImageModel[] }
    const data = (body.data ?? [])
      .map((raw) => toDomain(raw, zdrSlugs))
      .filter((model): model is OpenRouterImageModel => model !== null)
      .sort(
        (a, b) =>
          a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name)
      )
    if (data.length === 0) return MOCK_IMAGE_MODELS
    cache = { at: Date.now(), data }
    return data
  } catch {
    return MOCK_IMAGE_MODELS
  }
}

const priceCache = new Map<string, { at: number; price: string | null }>()
const PRICE_TTL_MS = 60 * 60 * 1000

/**
 * What one image costs on `modelId`, as a display string.
 *
 * One request per model, because that is what the catalog forces: pricing lives
 * on /models/{id}/endpoints, so pricing the whole list would be 43 round trips
 * to fill a select nobody has opened. Fetched for the SELECTED model only and
 * cached an hour, mirroring how lib/generation/endpoints.ts treats the text
 * side's endpoint list.
 *
 * Null whenever we do not know — no key, a fetch that failed, a model the
 * catalog declined to price. The caller renders nothing rather than a zero.
 */
export async function getImageModelPrice(
  modelId: string
): Promise<string | null> {
  const cached = priceCache.get(modelId)
  if (cached && Date.now() - cached.at < PRICE_TTL_MS) return cached.price

  const key = resolveOpenRouterKey()
  if (!key) return MOCK_IMAGE_PRICES[modelId] ?? null

  try {
    const res = await fetch(`${ENDPOINT}/${modelId}/endpoints`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!res.ok) return null
    const body = (await res.json()) as {
      endpoints?: {
        pricing?: { billable?: string; unit?: string; cost_usd?: number }[]
      }[]
    }
    // The first endpoint's output_image line. A model served by several
    // providers can be priced differently by each, and this picker does not pin
    // one — so this is "what it costs", not "what it will cost", which is why
    // the label says the unit rather than promising a total.
    const line = body.endpoints?.[0]?.pricing?.find(
      (entry) => entry.billable === "output_image"
    )
    const cost = line?.cost_usd
    const price =
      typeof cost === "number" && Number.isFinite(cost) && cost > 0
        ? // Four decimals: image prices run from a fraction of a cent to
          // several cents, and two would round the cheap half to "$0.00".
          `$${cost.toFixed(4)} / ${line?.unit ?? "image"}`
        : null
    priceCache.set(modelId, { at: Date.now(), price })
    return price
  } catch {
    return null
  }
}

/**
 * The model a story draws with: its own choice, then the app's default, then
 * the catalog's first entry.
 *
 * Resolved server-side so nothing has to invent a default. A stored STORY
 * choice that has since left the catalog is still honoured rather than
 * silently replaced — the writer chose it, and a request that fails loudly
 * beats one quietly served by a model they did not pick. That includes a
 * stored non-ZDR id under a ZDR policy: the generation path refuses it with a
 * message naming the problem.
 *
 * The APP default is held to a weaker standard on purpose: under a ZDR policy
 * an ineligible default is passed over rather than honoured into a refusal,
 * because a default is what the writer gets when they never chose — and what
 * they never chose must not be a model every request bounces off. Same for
 * `zdr` bending the final catalog fallback.
 */
export async function resolveImageModelId(
  storyChoice: string | null,
  zdr = false
): Promise<string> {
  if (storyChoice) return storyChoice
  const [models, settings] = await Promise.all([
    listImageModels(),
    getAppSettings(),
  ])
  const eligible = zdr ? models.filter((model) => model.zdr) : models
  const preferred = settings.defaultImageModelId
  if (
    preferred !== null &&
    (!zdr || eligible.some((model) => model.id === preferred))
  ) {
    return preferred
  }
  return eligible[0]?.id ?? models[0]?.id ?? MOCK_IMAGE_MODELS[0].id
}
