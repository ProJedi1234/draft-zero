// lib/import/aidungeon.ts — Reader for AI Dungeon story-card exports.
//
// AI Dungeon exports story cards in two shapes, and both arrive in the wild:
// the card list on its own, and a scenario object that carries the same list
// under one of several key spellings. Everything is read defensively — these
// files are traded between writers and edited by hand, so unknown keys are
// ignored and missing keys fall back.
//
// The shape we care about:
//
//   [ card, card, … ]                       a bare card export
//   { storyCards | story_cards | cards: [ … ],
//     title, description, prompt,
//     memory, authorsNote, tags[] }         a scenario export
//
//   card.keys                  usually ONE comma-separated string; card editors
//                              and script exporters also emit a real array
//   card.title                 the card's name
//   card.value                 the text AI Dungeon injects into context
//   card.description           an author-facing note; usually a copy of `value`
//   card.type                  free text. AI Dungeon's defaults are character,
//                              location, faction, race, class and
//                              worldDescription, but the field is editable per
//                              card and the UI title-cases it, so real exports
//                              mix "Character" with "location" and invent types
//                              like "Object" — see categoryFor.
//   card.useForCharacterCreation
//
// `useForCharacterCreation` is deliberately dropped: it marks a card as an
// option in AI Dungeon's character-creation flow, which has no counterpart
// here. It is emphatically not an enabled/disabled flag — every exported card
// is live — so mapping it onto `enabled` would silently mute half a lorebook.
//
// `worldDescription` is the one card type that is not really lore: it is the
// setting bible. It comes back twice — as `worldDescription` text, so the
// new-story path can seed the story's memory with it, and as `settingEntries`,
// always-active lore for the merge path, which must not touch an existing
// story's memory. The two are the same text, so every caller keeps exactly one:
// the new-story path takes the memory copy, the merge path takes the entries.
//
// This module is pure and client-safe: the import dialog parses here to preview
// a file, and the server action re-parses the same bytes rather than trusting
// the client's parse.

import {
  LOREBOOK_CATEGORIES,
  type LorebookCategory,
  type NewLorebookEntry,
} from "@/lib/types"

/** File extensions the import picker accepts. */
export const STORY_CARD_FILE_ACCEPT = ".json"

// A separate constant from novelai.ts's MAX_SCENARIO_BYTES even though the
// number is the same today: the two formats carry different payloads (a
// scenario embeds its whole opening text), so their ceilings should be free to
// drift without one importer silently redefining the other's limit.
//
// 1MB, not the 5MB this started at, because 5MB was a ceiling that never bound:
// Next caps a Server Action request body at 1MB by default and next.config.ts
// sets no bodySizeLimit, so anything between the two limits previewed happily
// and then died on submit with a rejection no reader could explain. Matching
// the real limit turns that into an honest "too large" before the file is even
// parsed. A 26-card export is about 20KB, so this is still ~50x any real file.
/** Refuse anything larger than this before parsing — card exports are tiny. */
export const MAX_CARDS_BYTES = 1024 * 1024

/** An AI Dungeon export reduced to draft-zero's domain shapes. */
export interface ParsedStoryCards {
  title: string
  description: string
  /** Opening passage, normalized to "\n\n"-separated paragraphs. */
  prompt: string
  /** The export's own memory, when it carried one. Empty for a bare array. */
  memory: string
  authorsNote: string
  tags: string[]
  /** Every `worldDescription` card's text, joined — the setting bible. */
  worldDescription: string
  /** Ordinary lore. Never contains a setting card; see `settingEntries`. */
  lorebookEntries: NewLorebookEntry[]
  /**
   * The setting cards, as always-active entries. Kept apart from the lore so
   * each caller can make one choice and not two: the new-story path seeds
   * `memory` from `worldDescription` and drops these, while the merge path
   * (which must not touch an existing story's memory) writes them and ignores
   * `worldDescription`. Exactly one of the two copies is ever kept.
   */
  settingEntries: NewLorebookEntry[]
  /** Human-readable notes about what was dropped or coerced. */
  warnings: string[]
}

export type ParseResult =
  | { ok: true; data: ParsedStoryCards }
  | {
      ok: false
      /**
       * Whether the file was recognisably an AI Dungeon export that then failed
       * to read, as opposed to something this reader has no claim on.
       *
       * The caller sniffs an unlabelled `.json` by offering it to each reader in
       * turn, and without this it cannot tell "not mine" from "mine, but
       * broken" — so an AI Dungeon scenario whose card list is empty fell
       * through to the NovelAI reader, which accepts anything carrying a string
       * `prompt`, and imported with the cards silently discarded.
       */
      recognised: boolean
      error: string
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

/**
 * CRLF and bare-CR line endings both become "\n" before anything else looks at
 * the text. Stripping "\r" instead — as an earlier version did — glues words
 * together on a CR-only file, because the line break disappears rather than
 * being replaced by one.
 */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n")
}

/**
 * For PROSE only — the opening passage and memory, which are subject to
 * draft-zero's paragraph contract (see lib/markdown.ts): paragraphs separated
 * by "\n\n". AI Dungeon writes hard breaks as single "\n", so every single
 * newline is promoted and runs of blank lines collapse.
 */
function toParagraphText(text: string): string {
  return normalizeNewlines(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n\n")
}

/**
 * For LORE, which is not prose and is deliberately left alone. Lore is rendered
 * verbatim inside a `[Lore: name]` block (lib/generation/context.ts) and never
 * goes through the paragraph contract, so the reader's job is to normalize line
 * endings and nothing else — novelai.ts stores its lore the same way.
 *
 * Running toParagraphText over it, as an earlier version did, double-spaced
 * every stat block and deleted its indentation: a card reading
 * "Elara\nAge: 24\n  Home: Somara" became three paragraphs with the alignment
 * stripped, in the editor and in every prompt the entry fired into.
 */
function toLoreText(text: string): string {
  return normalizeNewlines(text).trim()
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/**
 * `card.type` is free text, not an enum. AI Dungeon ships a default vocabulary
 * ("character", "location", "faction", "race", "class"), but the type is an
 * editable field on every card and the UI title-cases what it shows, so real
 * exports carry "Character" beside "location", invented types like "Object",
 * and multi-word ones like "Magic System". Treating it as a closed, exactly
 * spelled vocabulary is what put a file's Characters in Concepts.
 *
 * So the type is folded before lookup — case, spaces, underscores and hyphens
 * all vary by hand and none of them carry meaning — and a type that misses the
 * table falls through to CARD_TYPE_KEYWORDS below rather than straight into the
 * catch-all.
 */
function foldType(type: string): string {
  return type.toLowerCase().replace(/[\s_-]+/g, "")
}

/**
 * The literal table, keyed by folded type: AI Dungeon's own vocabulary plus the
 * synonyms writers actually type. A literal hit is exact and needs no warning.
 *
 * `race` goes to "character" because a race card describes who is in the world,
 * not a place or a group. `class` maps 1:1 — draft-zero grew a "class" category
 * precisely because these exports are full of them. `worldDescription` is a
 * concept: it is the setting itself.
 *
 * Lookups go through `Object.hasOwn` rather than `in`: a card typed
 * "constructor" or "__proto__" must be an unrecognised type, not an inherited
 * Object member masquerading as a category.
 */
const CARD_CATEGORIES: Readonly<Record<string, LorebookCategory>> = {
  character: "character",
  char: "character",
  npc: "character",
  person: "character",
  creature: "character",
  monster: "character",
  race: "character",
  species: "character",
  location: "location",
  place: "location",
  region: "location",
  setting: "location",
  item: "item",
  object: "item",
  thing: "item",
  artifact: "item",
  artefact: "item",
  weapon: "item",
  equipment: "item",
  faction: "faction",
  group: "faction",
  organization: "faction",
  organisation: "faction",
  guild: "faction",
  nation: "faction",
  kingdom: "faction",
  event: "event",
  history: "event",
  quest: "event",
  class: "class",
  archetype: "class",
  profession: "class",
  job: "class",
  concept: "concept",
  lore: "concept",
  note: "concept",
  other: "concept",
  worlddescription: "concept",
}

/**
 * Ordered fallback for types nobody anticipated — "Major Character", "Magic
 * System", "Key Location". Ordered because a compound type can match twice and
 * the earlier row is the more specific reading; substring matching on the raw
 * type is deliberate, since that is the only structure a hand-typed label has.
 *
 * A keyword hit is a guess, not a translation, so unlike a literal hit it is
 * still reported in the import warnings — the writer can see where their
 * vocabulary landed and re-file it.
 */
const CARD_TYPE_KEYWORDS: ReadonlyArray<[LorebookCategory, RegExp]> = [
  ["character", /char|person|people|npc|protagonist|creature|race|being/i],
  ["location", /location|place|setting|region|city|town|realm|geograph/i],
  ["faction", /faction|group|organi[sz]ation|guild|order|nation|kingdom|clan/i],
  ["class", /class|archetype|profession|vocation|job|role/i],
  ["item", /item|object|artifact|artefact|equipment|weapon|gear|treasure/i],
  ["event", /event|history|timeline|quest|plot/i],
  ["concept", /concept|magic|system|term|misc|rule|theme|lore|power|skill/i],
]

/**
 * The category for a card type, and whether it was an exact hit. `false` means
 * the type was guessed at or had no home at all — the caller warns about those
 * and lets an exact hit pass silently.
 */
function categoryFor(type: string): {
  category: LorebookCategory | null
  exact: boolean
} {
  const folded = foldType(type)
  if (Object.hasOwn(CARD_CATEGORIES, folded)) {
    return { category: CARD_CATEGORIES[folded], exact: true }
  }
  for (const [category, pattern] of CARD_TYPE_KEYWORDS) {
    if (pattern.test(type)) return { category, exact: false }
  }
  return { category: null, exact: false }
}

/** Folded, so "World Description" and "worldDescription" are the same card. */
const WORLD_DESCRIPTION_TYPE = "worlddescription"

/** The writer-facing name of a category, for the "filed by name" warning. */
function categoryLabel(category: LorebookCategory): string {
  return (
    LOREBOOK_CATEGORIES.find((option) => option.value === category)?.label ??
    category
  )
}

/**
 * Priority for the setting bible. Lore is trimmed greedily in priority order
 * against a fraction of the context budget (lib/generation/context.ts), so an
 * always-active entry is only guaranteed to *activate*, not to survive. A
 * 26-card import makes that a live risk, and the one card describing the world
 * is the last one a writer would want dropped.
 */
const WORLD_DESCRIPTION_PRIORITY = 70

/**
 * `keys` is a single comma-separated string here, unlike NovelAI's array. Our
 * matcher (lib/generation/lorebook.ts) lowercases both sides and tests plain
 * substring containment, so trimming is the only normalization that matters —
 * keys are stored verbatim because the editor shows them to the writer, and
 * duplicates are dropped case-insensitively because a duplicate that differs
 * only in case can never match anything the first one missed.
 */
/**
 * AI Dungeon itself writes `keys` as one comma-separated string, but card
 * editors and script exporters emit a real array, and reading only the string
 * form threw those away: the entry fell back to its title and silently stopped
 * firing on every trigger but one, while the warnings claimed it had none.
 * Both forms are accepted, and an array's elements are split on commas too,
 * since a one-element `["elf, elv"]` also occurs.
 */
function readKeys(raw: unknown): string[] {
  if (Array.isArray(raw)) return splitKeys(strArray(raw).join(","))
  return splitKeys(str(raw))
}

function splitKeys(raw: string): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const part of raw.split(",")) {
    const key = part.trim()
    if (key === "") continue
    const fold = key.toLowerCase()
    if (seen.has(fold)) continue
    seen.add(fold)
    keys.push(key)
  }
  return keys
}

/**
 * The text a card carries into context. `value` is what AI Dungeon injects and
 * `description` is the author-facing note, but exports routinely fill only one
 * of them (the sample's "Uruk" card has an empty `value` and a full
 * `description`), and in most cards the two are byte-identical copies. So:
 * prefer `value`, fall back to `description`, and when both exist and differ,
 * keep both as separate paragraphs rather than choosing which half of a
 * writer's work to throw away.
 */
function toContent(value: string, description: string): string {
  if (value === "") return description
  if (description === "" || description === value) return value
  return `${value}\n\n${description}`
}

interface ReadCards {
  entries: NewLorebookEntry[]
  settings: NewLorebookEntry[]
  worldDescription: string
  /** Title of the first worldDescription card, for the bare-array title. */
  worldTitle: string
}

function readCards(raw: unknown[], warnings: string[]): ReadCards {
  const entries: NewLorebookEntry[] = []
  const settings: NewLorebookEntry[] = []
  const worldTexts: string[] = []
  const unknownTypes = new Set<string>()
  /** Raw type → the category a keyword guess put it in. */
  const guessedTypes = new Map<string, LorebookCategory>()
  const names = new Set<string>()
  const duplicateNames = new Set<string>()
  let worldTitle = ""
  let skipped = 0
  let untitled = 0
  let keyedByTitle = 0
  let triggerless = 0

  for (const item of raw) {
    if (!isRecord(item)) {
      skipped += 1
      continue
    }

    const type = str(item.type).trim()
    const value = toLoreText(str(item.value))
    const description = toLoreText(str(item.description))
    const content = toContent(value, description)
    // A card with no text on either field carries nothing into context. Hand-
    // edited exports keep these around as blank templates.
    if (content === "") {
      skipped += 1
      continue
    }

    const folded = foldType(type)
    const { category, exact } = categoryFor(type)
    // Both an outright miss and a keyword guess are reported: the writer's own
    // vocabulary is the only thing that can tell them apart, so show the type
    // and where it went rather than deciding it was close enough.
    if (type !== "" && !exact) {
      if (category === null) unknownTypes.add(type)
      else guessedTypes.set(type, category)
    }

    const isWorld = folded === WORLD_DESCRIPTION_TYPE
    const title = str(item.title).trim()
    let keys = readKeys(item.keys)
    // A card with no triggers would never fire, and its title is what the
    // writer would have typed as a key anyway.
    if (keys.length === 0 && title !== "") {
      keys = [title]
      keyedByTitle += 1
    }

    const name = title || keys[0] || "Untitled entry"
    if (title === "") {
      // Only one of these is true at a time: with keys the entry takes the
      // first one as its name, and without them there is nothing to name it
      // after — and nothing to fire it either, unless it is always-active.
      if (keys.length > 0) untitled += 1
      else if (!isWorld) triggerless += 1
    }

    const fold = name.toLowerCase()
    if (names.has(fold)) duplicateNames.add(name)
    names.add(fold)

    if (isWorld) {
      worldTexts.push(content)
      if (worldTitle === "") worldTitle = title
    }

    // Setting cards go in their own bucket rather than being tagged inside the
    // lore list. `alwaysActive` is a persisted lorebook field that novelai.ts
    // fills from `forceActivation`, so a caller filtering on it to find the
    // setting bible would also catch any force-activated entry that arrived by
    // another route. Two lists make the distinction structural.
    ;(isWorld ? settings : entries).push({
      name,
      category: category ?? "concept",
      keys,
      content,
      // Story cards have no disabled state in the export — every card in the
      // file is one the writer is using.
      enabled: true,
      alwaysActive: isWorld,
      priority: isWorld ? WORLD_DESCRIPTION_PRIORITY : 50,
    })
  }

  if (skipped > 0) {
    warnings.push(
      `Skipped ${skipped} empty story ${skipped === 1 ? "card" : "cards"}.`
    )
  }
  if (guessedTypes.size > 0) {
    warnings.push(
      `Filed by name: ${[...guessedTypes]
        .map(([type, category]) => `${type} → ${categoryLabel(category)}`)
        .join(", ")}.`
    )
  }
  if (unknownTypes.size > 0) {
    warnings.push(
      `Unrecognised card ${unknownTypes.size === 1 ? "type" : "types"} (${[
        ...unknownTypes,
      ].join(", ")}) became Concepts.`
    )
  }
  if (keyedByTitle > 0) {
    warnings.push(
      `${keyedByTitle} ${
        keyedByTitle === 1
          ? "card had no trigger words — its title is"
          : "cards had no trigger words — their titles are"
      } the trigger instead.`
    )
  }
  if (untitled > 0) {
    warnings.push(
      `${untitled} ${untitled === 1 ? "card" : "cards"} had no title — named after ${
        untitled === 1 ? "its" : "their"
      } first trigger word.`
    )
  }
  if (triggerless > 0) {
    warnings.push(
      `${triggerless} ${
        triggerless === 1 ? "card has" : "cards have"
      } no title and no trigger words — ${
        triggerless === 1 ? "it" : "they"
      } won't reach a generation until you give ${
        triggerless === 1 ? "it one" : "them some"
      }.`
    )
  }
  if (duplicateNames.size > 0) {
    warnings.push(
      `Duplicate card ${
        duplicateNames.size === 1 ? "title" : "titles"
      } (${[...duplicateNames].join(", ")}) ${
        duplicateNames.size === 1 ? "was" : "were"
      } imported as separate entries.`
    )
  }

  return {
    entries,
    settings,
    worldDescription: worldTexts.join("\n\n"),
    worldTitle,
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** The key spellings AI Dungeon and its exporters have used for the card list. */
const CARD_LIST_KEYS = ["storyCards", "story_cards", "cards"] as const

/**
 * The card list, preferring a populated one. An export that carries both an
 * empty `storyCards` and a full `cards` is real — exporters that renamed the
 * key leave the old one behind as `[]` — so returning the first array-valued
 * key regardless of contents rejected a perfectly good file. A present-but-
 * empty key still counts as recognition, which is why the empty array is
 * returned when it is all there is.
 */
function readCardList(raw: Record<string, unknown>): unknown[] | null {
  let empty: unknown[] | null = null
  for (const key of CARD_LIST_KEYS) {
    const value = raw[key]
    if (!Array.isArray(value)) continue
    if (value.length > 0) return value
    empty ??= value
  }
  return empty
}

/**
 * Parses an AI Dungeon story-card export. Accepts the raw file text or an
 * already-parsed value, and either shape of the format. Never throws:
 * malformed input comes back as `{ ok: false }`.
 */
export function parseStoryCards(input: unknown): ParseResult {
  let raw: unknown = input

  if (typeof input === "string") {
    if (input.trim() === "") {
      return { ok: false, recognised: false, error: "The file is empty." }
    }
    try {
      raw = JSON.parse(input)
    } catch {
      return {
        ok: false,
        recognised: false,
        error: "That file isn't valid JSON.",
      }
    }
  }

  let cards: unknown[]
  let wrapper: Record<string, unknown> = {}

  if (Array.isArray(raw)) {
    // A top-level array could only ever have been a card export, so even an
    // empty one is this reader's to complain about.
    cards = raw
  } else if (isRecord(raw)) {
    const list = readCardList(raw)
    if (!list) {
      // This is where a NovelAI .scenario lands: an object, plausibly a story
      // export, with no card list anywhere in it. Not ours.
      return {
        ok: false,
        recognised: false,
        error: "That file isn't an AI Dungeon export — no story cards in it.",
      }
    }
    cards = list
    wrapper = raw
  } else {
    return {
      ok: false,
      recognised: false,
      error: "That file isn't an AI Dungeon export.",
    }
  }

  // Everything below here is a file this reader claims: it had a card list, it
  // was just unusable. Saying so beats handing it to another reader that would
  // accept it on some other field and drop the cards.
  if (cards.length === 0) {
    return {
      ok: false,
      recognised: true,
      error: "That file has no story cards in it.",
    }
  }

  const warnings: string[] = []
  const read = readCards(cards, warnings)

  // Every row was unreadable or blank — the file is card-shaped in name only,
  // and importing nothing is worse than saying so. Setting cards count: a file
  // that is nothing but a worldDescription still carries something.
  if (read.entries.length === 0 && read.settings.length === 0) {
    return {
      ok: false,
      recognised: true,
      error: "None of the story cards in that file have any text.",
    }
  }

  // A bare array carries no title, and a file of world-building deserves a
  // better name than its filename: the worldDescription card is named after the
  // world itself, which is the closest thing to a title the format has.
  const title =
    str(wrapper.title).trim() || read.worldTitle || "Imported story cards"

  return {
    ok: true,
    data: {
      title,
      description: str(wrapper.description).trim(),
      prompt: toParagraphText(str(wrapper.prompt)),
      memory: toParagraphText(str(wrapper.memory)),
      authorsNote: toParagraphText(
        str(wrapper.authorsNote) || str(wrapper.authors_note)
      ),
      tags: [...new Set(strArray(wrapper.tags))],
      worldDescription: read.worldDescription,
      lorebookEntries: read.entries,
      settingEntries: read.settings,
      warnings,
    },
  }
}
