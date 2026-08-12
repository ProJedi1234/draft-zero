// lib/import/novelai.ts — Reader for NovelAI `.scenario` files.
//
// A .scenario is a single JSON object. NovelAI has shipped several revisions
// (`scenarioVersion` 1–4); the fields below are the union of what those emit,
// and everything is read defensively because scenarios are shared as files and
// arrive from strangers. Unknown keys are ignored, missing keys fall back.
//
// The shape we care about:
//
//   title, description, author, tags[], attg{tags[],genre[]}
//   prompt                     the opening passage
//   context[0].text            Memory       (budgetPriority 800, top of ctx)
//   context[1].text            Author's Note(budgetPriority -400, near the end)
//   placeholders[]             import-time fill-ins, see PLACEHOLDER_RE
//   lorebook.entries[]         displayName / text / keys / forceActivation
//   lorebook.categories[]      uuid → human name, referenced by entry.category
//   settings.parameters        NovelAI sampler settings
//
// Legacy scenarios (and third-party generators like novelai-research-tool)
// instead write flat `memory` / `authorsNote` / `authors_note` strings, so both
// spellings are accepted.
//
// This module is pure and client-safe: the import dialog parses here to preview
// a file, and lib/actions/import.ts re-parses the same bytes server-side rather
// than trusting the client's parse.

import type {
  GenerationSettings,
  LorebookCategory,
  NewLorebookEntry,
} from "@/lib/types"

/** File extensions the import picker accepts. */
export const SCENARIO_FILE_ACCEPT = ".scenario,.json"

/** Refuse anything larger than this before parsing — scenarios are tiny. */
export const MAX_SCENARIO_BYTES = 5 * 1024 * 1024

/**
 * An import-time fill-in declared in the scenario text.
 * Syntax: `${1#name[default]Title:Description}` — every part after the id is
 * optional, so a bare `${name}` is legal too.
 */
export interface ScenarioPlaceholder {
  id: string
  /** Display order; placeholders without a numeric prefix sort last. */
  order: number
  defaultValue: string
  title: string
  description: string
}

/** A NovelAI scenario reduced to draft-zero's domain shapes. */
export interface ParsedScenario {
  scenarioVersion: number
  title: string
  description: string
  author: string
  genre: string
  tags: string[]
  /** Opening passage, normalized to "\n\n"-separated paragraphs. */
  prompt: string
  memory: string
  authorsNote: string
  /** Only the settings that survive the translation to OpenRouter. */
  settings: Partial<GenerationSettings>
  lorebookEntries: NewLorebookEntry[]
  placeholders: ScenarioPlaceholder[]
  /** Human-readable notes about what was dropped or coerced. */
  warnings: string[]
}

export type ParseResult =
  { ok: true; data: ParsedScenario } | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

// `$` fills the value in place; `%` is NovelAI's "table of contents" form,
// which declares a placeholder on its own line and renders nothing.
const PLACEHOLDER_RE = /([$%])\{([^{}]*)\}/g

/** `1#id[default]Title:Description` — every part but the id is optional. */
function parsePlaceholderBody(body: string): ScenarioPlaceholder | null {
  let rest = body
  let order = Number.MAX_SAFE_INTEGER

  const ordered = /^(\d+)#([\s\S]*)$/.exec(rest)
  if (ordered) {
    order = Number(ordered[1])
    rest = ordered[2]
  }

  // The id runs until the default's `[`, the description's `:`, or the end.
  const idMatch = /^([^[:]*)([\s\S]*)$/.exec(rest)
  if (!idMatch) return null
  const id = idMatch[1].trim()
  if (id === "") return null
  rest = idMatch[2]

  let defaultValue = ""
  const withDefault = /^\[([^\]]*)\]([\s\S]*)$/.exec(rest)
  if (withDefault) {
    defaultValue = withDefault[1]
    rest = withDefault[2]
  }

  const colon = rest.indexOf(":")
  const title = (colon === -1 ? rest : rest.slice(0, colon)).trim()
  const description = colon === -1 ? "" : rest.slice(colon + 1).trim()

  return { id, order, defaultValue, title, description }
}

/** Every distinct placeholder declared across the given texts, in fill order. */
export function collectPlaceholders(texts: string[]): ScenarioPlaceholder[] {
  const byId = new Map<string, ScenarioPlaceholder>()

  for (const text of texts) {
    for (const match of text.matchAll(PLACEHOLDER_RE)) {
      const parsed = parsePlaceholderBody(match[2])
      if (!parsed) continue
      const existing = byId.get(parsed.id)
      // First declaration wins, but a later one may supply the metadata the
      // first omitted — scenarios routinely declare `${1#name[Ash]Name}` once
      // and then reference a bare `${name}` throughout.
      if (!existing) {
        byId.set(parsed.id, parsed)
        continue
      }
      byId.set(parsed.id, {
        id: parsed.id,
        order: Math.min(existing.order, parsed.order),
        defaultValue: existing.defaultValue || parsed.defaultValue,
        title: existing.title || parsed.title,
        description: existing.description || parsed.description,
      })
    }
  }

  return [...byId.values()].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id)
  )
}

/**
 * Substitutes every `${…}` with the user's value (falling back to the declared
 * default) and strips the `%{…}` table-of-contents form along with the blank
 * line it leaves behind.
 */
export function fillPlaceholders(
  text: string,
  values: Record<string, string>
): string {
  const filled = text.replace(PLACEHOLDER_RE, (_match, sigil: string, body) => {
    const parsed = parsePlaceholderBody(String(body))
    if (!parsed) return ""
    if (sigil === "%") return ""
    const value = values[parsed.id]
    return value !== undefined && value !== "" ? value : parsed.defaultValue
  })
  // A table-of-contents block collapses to leading blank lines.
  return filled.replace(/^[ \t]*\n+/, "")
}

/** Applies placeholder values to every text-bearing field of a scenario. */
export function fillScenarioPlaceholders(
  scenario: ParsedScenario,
  values: Record<string, string>
): ParsedScenario {
  const fill = (text: string) => fillPlaceholders(text, values)
  return {
    ...scenario,
    title: fill(scenario.title),
    description: fill(scenario.description),
    prompt: fill(scenario.prompt),
    memory: fill(scenario.memory),
    authorsNote: fill(scenario.authorsNote),
    lorebookEntries: scenario.lorebookEntries.map((entry) => ({
      ...entry,
      name: fill(entry.name),
      content: fill(entry.content),
      keys: entry.keys.map(fill).filter((key) => key !== ""),
    })),
    placeholders: [],
  }
}

// ---------------------------------------------------------------------------
// Field readers (every one tolerates a wrong-typed or absent value)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item !== "")
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * NovelAI writes hard line breaks as single "\n"; draft-zero's prose contract
 * separates paragraphs with "\n\n" (see lib/markdown.ts). Promote every single
 * newline to a paragraph break and collapse runs of blank lines.
 */
function toParagraphText(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/\r/g, "").trim())
    .filter((line) => line !== "")
    .join("\n\n")
}

// ---------------------------------------------------------------------------
// Lorebook
// ---------------------------------------------------------------------------

/**
 * NovelAI categories are free-text names, draft-zero's are a fixed enum, so
 * the category name is matched by keyword and anything unrecognised lands in
 * "concept" — the enum's catch-all.
 */
const CATEGORY_KEYWORDS: ReadonlyArray<[LorebookCategory, RegExp]> = [
  ["character", /char|person|people|cast|npc|protagonist|creature|race/i],
  ["location", /location|place|setting|world|region|city|geograph/i],
  ["faction", /faction|group|organi[sz]ation|guild|order|nation|kingdom/i],
  ["item", /item|object|artifact|artefact|equipment|weapon|gear/i],
  ["event", /event|history|timeline|lore ?event|plot/i],
  ["concept", /concept|magic|system|term|misc|rule|theme/i],
]

function toCategory(name: string): LorebookCategory {
  for (const [category, pattern] of CATEGORY_KEYWORDS) {
    if (pattern.test(name)) return category
  }
  return "concept"
}

/**
 * NovelAI's `budgetPriority` is an unbounded signed number (400 is the entry
 * default, ±1000 covers the usable range in practice); draft-zero's priority is
 * 0–100 with 50 as the middle. Map linearly and clamp the outliers.
 */
function toPriority(budgetPriority: number | undefined): number {
  if (budgetPriority === undefined) return 50
  return clamp(Math.round(((budgetPriority + 1000) / 2000) * 100), 0, 100)
}

/**
 * Keys may be plain substrings or NovelAI regex keys (`/pattern/i`). Our
 * matcher (lib/generation/lorebook.ts) is substring-only, so a regex key is
 * reduced to its pattern text — the caller warns when that happens.
 */
function toKey(key: string): { key: string; wasRegex: boolean } {
  const regex = /^\/([\s\S]*)\/[gimsuy]*$/.exec(key)
  if (!regex) return { key, wasRegex: false }
  return { key: regex[1].replace(/\\([./\\])/g, "$1"), wasRegex: true }
}

function readLorebook(raw: unknown, warnings: string[]): NewLorebookEntry[] {
  if (!isRecord(raw)) return []

  const categoryNames = new Map<string, string>()
  if (Array.isArray(raw.categories)) {
    for (const category of raw.categories) {
      if (!isRecord(category)) continue
      const id = str(category.id)
      if (id !== "") categoryNames.set(id, str(category.name))
    }
  }

  const entries: NewLorebookEntry[] = []
  let skipped = 0
  let loweredRegex = false

  for (const item of Array.isArray(raw.entries) ? raw.entries : []) {
    if (!isRecord(item)) continue

    const content = str(item.text).trim()
    const name = str(item.displayName).trim()
    // NovelAI keeps placeholder rows (category defaults, blank templates) in the
    // same array; an entry with no text carries nothing into context.
    if (content === "") {
      skipped += 1
      continue
    }

    const keys: string[] = []
    for (const rawKey of strArray(item.keys)) {
      const { key, wasRegex } = toKey(rawKey)
      if (wasRegex) loweredRegex = true
      if (key !== "") keys.push(key)
    }

    entries.push({
      name: name || keys[0] || "Untitled entry",
      category: toCategory(categoryNames.get(str(item.category)) ?? ""),
      keys,
      content,
      enabled: item.enabled !== false,
      alwaysActive: item.forceActivation === true,
      priority: toPriority(
        num(
          isRecord(item.contextConfig)
            ? item.contextConfig.budgetPriority
            : undefined
        )
      ),
    })
  }

  if (skipped > 0) {
    warnings.push(
      `Skipped ${skipped} empty lorebook ${skipped === 1 ? "entry" : "entries"}.`
    )
  }
  if (loweredRegex) {
    warnings.push(
      "Regex lorebook keys were converted to plain text — matching is substring-only here."
    )
  }

  return entries
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Only temperature and top-p carry over. NovelAI's `model` names its own
 * models, its repetition penalties use a different scale than OpenRouter's
 * frequency/presence penalties, and `max_length` is a per-step continuation
 * length (often 40 tokens) rather than a response budget — importing any of
 * them would silently produce worse generations than the app's defaults. The
 * scenario's own context size is skipped for the same reason: NovelAI counts it
 * against a different tokenizer and a different context layout, so the number
 * means something else here. The imported story takes the app default window.
 */
function readSettings(
  raw: unknown,
  warnings: string[]
): Partial<GenerationSettings> {
  if (!isRecord(raw)) return {}
  const parameters = isRecord(raw.parameters) ? raw.parameters : {}
  const settings: Partial<GenerationSettings> = {}

  const temperature = num(parameters.temperature)
  if (temperature !== undefined) settings.temperature = clamp(temperature, 0, 2)

  const topP = num(parameters.top_p)
  if (topP !== undefined) settings.topP = clamp(topP, 0, 1)

  if (str(raw.model) !== "" || Object.keys(parameters).length > 0) {
    warnings.push(
      "Kept temperature and top-p only — NovelAI's model and repetition penalties have no OpenRouter equivalent."
    )
  }

  return settings
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Memory and Author's Note, in that fixed order, from the `context` array. */
function readContext(raw: unknown): { memory: string; authorsNote: string } {
  if (!Array.isArray(raw)) return { memory: "", authorsNote: "" }
  const textAt = (index: number): string => {
    const slot = raw[index]
    return isRecord(slot) ? str(slot.text).trim() : ""
  }
  return { memory: textAt(0), authorsNote: textAt(1) }
}

/**
 * Parses a `.scenario` file. Accepts the raw file text or an already-parsed
 * object. Never throws: malformed input comes back as `{ ok: false }`.
 */
export function parseScenario(input: string | unknown): ParseResult {
  let raw: unknown = input

  if (typeof input === "string") {
    if (input.trim() === "") return { ok: false, error: "The file is empty." }
    try {
      raw = JSON.parse(input)
    } catch {
      return { ok: false, error: "That file isn't valid JSON." }
    }
  }

  if (!isRecord(raw)) {
    return { ok: false, error: "That file isn't a NovelAI scenario." }
  }

  const warnings: string[] = []

  // `prompt` is the one field every scenario revision has carried.
  if (typeof raw.prompt !== "string") {
    return {
      ok: false,
      error: "That file isn't a NovelAI scenario — no story prompt in it.",
    }
  }

  const scenarioVersion = num(raw.scenarioVersion) ?? 0
  if (scenarioVersion > 4) {
    warnings.push(
      `This scenario is version ${scenarioVersion}; fields newer than version 4 were ignored.`
    )
  }

  const context = readContext(raw.context)
  // Legacy and third-party scenarios write flat strings instead.
  const memory = context.memory || str(raw.memory).trim()
  const authorsNote =
    context.authorsNote ||
    str(raw.authorsNote).trim() ||
    str(raw.authors_note).trim()

  const attg = isRecord(raw.attg) ? raw.attg : {}
  const tags = [...new Set([...strArray(raw.tags), ...strArray(attg.tags)])]
  const genreTags = strArray(attg.genre)

  const title = str(raw.title).trim() || "Imported scenario"
  const prompt = toParagraphText(str(raw.prompt))
  const lorebookEntries = readLorebook(raw.lorebook, warnings)
  const settings = readSettings(raw.settings, warnings)

  if (Array.isArray(raw.userScripts) && raw.userScripts.length > 0) {
    warnings.push("User scripts were not imported.")
  }
  if (Array.isArray(raw.ephemeralContext) && raw.ephemeralContext.length > 0) {
    warnings.push("Ephemeral context entries were not imported.")
  }

  const placeholders = collectPlaceholders([
    title,
    str(raw.description),
    prompt,
    memory,
    authorsNote,
    ...lorebookEntries.flatMap((entry) => [
      entry.name,
      entry.content,
      ...entry.keys,
    ]),
  ])

  return {
    ok: true,
    data: {
      scenarioVersion,
      title,
      description: str(raw.description).trim(),
      author: str(raw.author).trim(),
      genre: (genreTags.length > 0 ? genreTags : tags).join(", "),
      tags,
      prompt,
      memory,
      authorsNote,
      settings,
      lorebookEntries,
      placeholders,
      warnings,
    },
  }
}
