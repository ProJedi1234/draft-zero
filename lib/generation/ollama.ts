// lib/generation/ollama.ts — The local Ollama host: where it is, what it has
// installed, and how it is doing. Server-only, and the sibling of models.ts for
// the second backend. The chat and decision clients live in ollama-chat.ts and
// decide.ts; this module only answers "what can be asked for".
import "server-only"

import {
  LOCAL_MODEL_PREFIX,
  type DecisionModel,
  type LocalModelInfo,
  type LocalModelsStatus,
  type ModelReasoning,
  type OpenRouterModel,
} from "@/lib/types"

/** Local models come and go with `ollama pull`, so the list is short-lived. */
const TTL_MS = 30 * 1000
/**
 * Every page payload reads the catalog, so a dead host must cost a page almost
 * nothing. Failures are cached for the same TTL as answers.
 */
const CATALOG_TIMEOUT_MS = 2_000
const DEFAULT_CONTEXT_WINDOW = 65_536

/** OLLAMA_BASE_URL without a trailing slash, or null when local models are off. */
export function resolveOllamaBaseUrl(): string | null {
  const raw = process.env.OLLAMA_BASE_URL?.trim()
  return raw ? raw.replace(/\/+$/, "") : null
}

/**
 * The num_ctx sent with every local request. Fixed rather than per story:
 * Ollama reloads a model whenever a request asks for a different window, and a
 * reload costs a full re-read of the prompt.
 */
export function resolveOllamaContextWindow(): number {
  const n = Number(process.env.OLLAMA_NUM_CTX)
  return Number.isInteger(n) && n >= 2048 ? n : DEFAULT_CONTEXT_WINDOW
}

/** "http://metis.olympus.lan:11434" → "metis"; an IP address stays whole. */
export function hostLabel(baseUrl: string): string {
  try {
    const { hostname } = new URL(baseUrl)
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[")) {
      return hostname
    }
    return hostname.split(".")[0] || baseUrl
  } catch {
    return baseUrl
  }
}

export function localModelId(name: string): string {
  return `${LOCAL_MODEL_PREFIX}${name}`
}

/** The Ollama model name behind a local id. */
export function ollamaModelName(modelId: string): string {
  return modelId.slice(LOCAL_MODEL_PREFIX.length)
}

interface TagsResponse {
  models?: {
    name: string
    digest?: string
    details?: { family?: string; quantization_level?: string }
  }[]
}

interface ShowResponse {
  capabilities?: string[]
  model_info?: Record<string, unknown>
  /** The Modelfile's PARAMETER lines, one "name value" per line. */
  parameters?: string
}

interface PsResponse {
  models?: { name: string; expires_at?: string }[]
}

type Kind = "chat" | "decision"

interface InstalledModel {
  name: string
  kind: Kind
  family: string | null
  quantization: string | null
  thinking: boolean
  trainedContext: number | null
  /** The Modelfile's num_ctx, which a decision request cannot override. */
  numCtx: number | null
}

interface Snapshot {
  baseUrl: string
  version: string
  models: InstalledModel[]
  /** Loaded model name → when Ollama unloads it. */
  loaded: Map<string, string | null>
}

let cache: { at: number; baseUrl: string; data: Snapshot | null } | null = null
let pending: { baseUrl: string; promise: Promise<Snapshot | null> } | null =
  null
/** Capabilities never change for a digest, so /api/show is asked once per model. */
const showCache = new Map<string, ShowResponse>()

async function getJson<T>(
  baseUrl: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`Ollama ${path} answered ${res.status}`)
  return (await res.json()) as T
}

/**
 * Chat, decision, or neither. Ollama 0.35.1+ reports a decision model with
 * `decision` as its only capability; an embedding model has neither flag and
 * is left out of every picker.
 */
function kindOf(capabilities: string[]): Kind | null {
  if (capabilities.includes("decision")) return "decision"
  if (capabilities.includes("completion")) return "chat"
  return null
}

function trainedContext(info: Record<string, unknown> | undefined) {
  for (const [key, value] of Object.entries(info ?? {})) {
    if (key.endsWith(".context_length") && typeof value === "number") {
      return value
    }
  }
  return null
}

async function fetchSnapshot(baseUrl: string): Promise<Snapshot> {
  const [version, tags, ps] = await Promise.all([
    getJson<{ version?: string }>(baseUrl, "/api/version"),
    getJson<TagsResponse>(baseUrl, "/api/tags"),
    getJson<PsResponse>(baseUrl, "/api/ps"),
  ])
  const models = await Promise.all(
    (tags.models ?? []).map(async (tag): Promise<InstalledModel | null> => {
      const showKey = `${tag.name}@${tag.digest ?? ""}`
      let show = showCache.get(showKey)
      if (!show) {
        show = await getJson<ShowResponse>(baseUrl, "/api/show", {
          model: tag.name,
        })
        showCache.set(showKey, show)
      }
      const capabilities = show.capabilities ?? []
      const kind = kindOf(capabilities)
      if (kind === null) return null
      return {
        name: tag.name,
        kind,
        family: tag.details?.family || null,
        quantization: tag.details?.quantization_level || null,
        thinking: capabilities.includes("thinking"),
        trainedContext: trainedContext(show.model_info),
        numCtx:
          Number(/^num_ctx\s+(\d+)/m.exec(show.parameters ?? "")?.[1]) || null,
      }
    })
  )
  return {
    baseUrl,
    version: version.version ?? "unknown",
    models: models.filter((m): m is InstalledModel => m !== null),
    loaded: new Map(
      (ps.models ?? []).map((m) => [m.name, m.expires_at ?? null])
    ),
  }
}

/** The host's current state, or null when it is unconfigured or not answering. */
async function snapshot(): Promise<Snapshot | null> {
  const baseUrl = resolveOllamaBaseUrl()
  if (!baseUrl) return null
  if (cache && cache.baseUrl === baseUrl && Date.now() - cache.at < TTL_MS) {
    return cache.data
  }
  // Settings asks for chat models, decision models and status at once, and
  // they should share one round of requests to the host.
  if (pending?.baseUrl === baseUrl) return pending.promise
  const promise = fetchSnapshot(baseUrl)
    .catch(() => null)
    .then((data) => {
      cache = { at: Date.now(), baseUrl, data }
      pending = null
      return data
    })
  pending = { baseUrl, promise }
  return promise
}

/**
 * "qwen3.8:27b-mlx" → "Qwen 3.8 27B". The quantization and runner suffixes
 * are left to the row's detail line, which shows them separately.
 */
export function displayName(name: string): string {
  const [base, tag = ""] = name.split(":")
  const words = (base.split("/").pop() ?? base)
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.replace(/^([a-z]+)(\d)/i, "$1 $2"))
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  const size = tag.split(/[-_]/).find((part) => /^\d+(\.\d+)?[bm]$/i.test(part))
  return [...words, ...(size ? [size.toUpperCase()] : [])].join(" ")
}

/**
 * Display names for a set of models, falling back to the raw Ollama name when
 * two of them would read the same (two quantizations of one model).
 */
function displayNames(models: InstalledModel[]): Map<string, string> {
  const pretty = models.map((m) => [m.name, displayName(m.name)] as const)
  const counts = new Map<string, number>()
  for (const [, label] of pretty)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  return new Map(
    pretty.map(([name, label]) => [
      name,
      (counts.get(label) ?? 0) > 1 ? name : label,
    ])
  )
}

/**
 * gpt-oss takes Ollama's three named levels; every other thinking model takes
 * a plain on/off, which the picker shows as Off and one level.
 */
function reasoningFor(model: InstalledModel): ModelReasoning | null {
  if (!model.thinking) return null
  if (model.family?.startsWith("gptoss") || model.name.startsWith("gpt-oss")) {
    return { efforts: ["low", "medium", "high"], mandatory: false }
  }
  return { efforts: ["medium"], mandatory: false }
}

function localInfo(snap: Snapshot, model: InstalledModel): LocalModelInfo {
  return {
    host: hostLabel(snap.baseUrl),
    loaded: snap.loaded.has(model.name),
    quantization: model.quantization,
  }
}

/** Installed chat models, shaped as catalog entries. [] when local models are off. */
export async function listOllamaChatModels(): Promise<OpenRouterModel[]> {
  const snap = await snapshot()
  if (!snap) return []
  const chat = snap.models.filter((m) => m.kind === "chat")
  const names = displayNames(chat)
  const window = resolveOllamaContextWindow()
  const host = hostLabel(snap.baseUrl)
  return chat
    .map((m): OpenRouterModel => ({
      id: localModelId(m.name),
      name: names.get(m.name) ?? m.name,
      provider: `Ollama · ${host}`,
      // What the composer can actually fill: the window sent, capped by what
      // the weights were trained for.
      contextLength: Math.min(window, m.trainedContext ?? window),
      maxCompletionTokens: null,
      pricing: { prompt: "$0.00", completion: "$0.00" },
      reasoning: reasoningFor(m),
      zdr: true,
      local: localInfo(snap, m),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Installed decision models. [] when local models are off. */
export async function listOllamaDecisionModels(): Promise<DecisionModel[]> {
  const snap = await snapshot()
  if (!snap) return []
  const decision = snap.models.filter((m) => m.kind === "decision")
  const names = displayNames(decision)
  return decision
    .map((m): DecisionModel => ({
      id: localModelId(m.name),
      name: names.get(m.name) ?? m.name,
      provider: `Ollama · ${hostLabel(snap.baseUrl)}`,
      // Each question is scored as its own prompt within the Modelfile's
      // num_ctx, so that, not the trained length, is the usable window.
      contextLength: m.numCtx ?? m.trainedContext ?? 0,
      promptPrice: "$0.00",
      inputModalities: ["text"],
      zdr: true,
      local: localInfo(snap, m),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The Settings card's view of the host, or null when local models are off. */
export async function getLocalModelsStatus(): Promise<LocalModelsStatus | null> {
  const baseUrl = resolveOllamaBaseUrl()
  if (!baseUrl) return null
  const snap = await snapshot()
  const host = hostLabel(baseUrl)
  const contextWindow = resolveOllamaContextWindow()
  if (!snap) {
    return {
      host,
      baseUrl,
      reachable: false,
      version: null,
      chatModels: 0,
      decisionModels: 0,
      contextWindow,
      loaded: [],
    }
  }
  return {
    host,
    baseUrl,
    reachable: true,
    version: snap.version,
    chatModels: snap.models.filter((m) => m.kind === "chat").length,
    decisionModels: snap.models.filter((m) => m.kind === "decision").length,
    contextWindow,
    // Only models a picker offers; an embedder in memory is not the writer's.
    loaded: snap.models
      .filter((m) => snap.loaded.has(m.name))
      .map((m) => ({
        modelId: localModelId(m.name),
        name: displayName(m.name),
        expiresAt: snap.loaded.get(m.name) ?? null,
      })),
  }
}

/** Drops the cached snapshot, for tests and for a request that just found a model gone. */
export function invalidateOllamaCatalog(): void {
  cache = null
  pending = null
}
