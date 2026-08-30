// lib/import/aidungeon-backup.ts — Reader for AI Dungeon's backup export.
//
// The story-card export (aidungeon.ts) is a world with no story in it. A backup
// is the whole adventure: the same story cards, plus the adventure's own
// memory, author's note and tags, plus every action the writer and the model
// ever took. It is the only AI Dungeon format that can arrive as a manuscript
// rather than a lorebook, which is the entire reason this module exists beside
// the other one instead of inside it.
//
// The archive:
//
//   metadata.json      { exportedAt,
//                        adventure: { title, description, memory, authorsNote,
//                                     tags[], … },
//                        state: { storyCards[], memories[], storySummary,
//                                 instructions{}, … },
//                        totalActionCount, totalParts }
//   actions-001.json   { partNumber, totalParts, actions: [ … ] }
//   actions-002.json   … one part per chunk, numbered from 001
//
// An action is { id, type, text, createdAt }. `type` is what makes it a
// passage or a player turn:
//
//   start      the scenario's opening text, exactly once, first
//   continue   model output
//   do / say   a player turn — and AI Dungeon stores it ALREADY RENDERED,
//              as "> You open the door.", not as the writer's "I open the door"
//   story      prose the writer typed straight into the manuscript
//   see        an image beat; a text backup carries no image, so it is dropped
//
// `state.memories` is dropped outright. It is AI Dungeon's recall store, not
// its Plot Essentials — `adventure.memory` is that, and that is what becomes
// the story's memory. See countMemories.
//
// The adventure's AI instructions are the one field that does not land in the
// story's context at all: they replace the narrator prompt outright, which is
// what AI Dungeon writes them as. See readInstructions.
//
// The rendered-not-raw storage of do/say is the one lossy corner of this
// reader, and it is lossy in AI Dungeon, not here: the writer's original
// first-person input is not in the file. draft-zero stores both halves of a
// player turn (`text` is the second-person prose, `input_text` the writer's
// own words, and the pair is always set together), so the input is
// reconstructed from the rendering — the chevron comes off, a Say's quoted
// line is unwrapped back to what was said — and then run through the app's own
// translateAction, so an imported turn is byte-identical to one the composer
// would have written and stays re-editable. See toPassage.
//
// This module is pure and isomorphic: the import dialog reads the archive to
// preview it, and the server action re-reads the same bytes rather than
// trusting the client's parse.

import {
  isRecord,
  readCards,
  str,
  strArray,
  toLoreText,
  toParagraphText,
} from "@/lib/import/aidungeon"
import { openZip, ZipError, type ZipArchive } from "@/lib/import/zip"
import { translateAction } from "@/lib/story/action-voice"
import type { ActionKind, NewLorebookEntry } from "@/lib/types"

/** File extensions the import picker accepts for a backup. */
export const BACKUP_FILE_ACCEPT = ".zip"

// Compressed bytes, not the inflated JSON, because the zip is what crosses the
// wire: the action goes over a Server Action body, whose limit next.config.ts
// raises to match this. 16MB of deflated JSON is on the order of a hundred
// thousand passages — far past any real adventure, and still small enough that
// inflating it on the server is not a denial-of-service surface.
/** Refuse anything larger than this before opening the archive. */
export const MAX_BACKUP_BYTES = 16 * 1024 * 1024

/**
 * How much the archive is allowed to inflate to, in total.
 *
 * It sits beside MAX_BACKUP_BYTES because the pair only makes sense together:
 * the ceiling above bounds what crosses the wire, and this one bounds what
 * comes out the other side. Capping only the first caps nothing — DEFLATE
 * reaches about 1032:1, so 16MB of archive can describe ~16GB of output.
 *
 * 8x the compressed ceiling. The real AI Dungeon sample inflates 4.8:1, so this
 * is generous headroom for an honest backup at the largest size we accept,
 * while leaving a bomb two orders of magnitude short of what it wants.
 */
export const MAX_BACKUP_INFLATED_BYTES = MAX_BACKUP_BYTES * 8

/** One manuscript row, as the story would have written it. */
export interface ParsedBackupPassage {
  source: "user" | "generated"
  /** Second-person prose, under the paragraph contract. */
  text: string
  /** Set together with `inputText`, or both null on narration. */
  actionKind: ActionKind | null
  inputText: string | null
}

/** An AI Dungeon backup reduced to draft-zero's domain shapes. */
export interface ParsedBackup {
  title: string
  description: string
  /** The adventure's Plot Essentials. Never its `memories` store. */
  memory: string
  authorsNote: string
  tags: string[]
  /** Every `worldDescription` card's text, joined — the setting bible. */
  worldDescription: string
  /** Ordinary lore. Never contains a setting card; see `settingEntries`. */
  lorebookEntries: NewLorebookEntry[]
  /** The setting cards as always-active entries; see aidungeon.ts. */
  settingEntries: NewLorebookEntry[]
  /** The manuscript, in order. */
  passages: ParsedBackupPassage[]
  /** AI Dungeon's own rolling summary, when it had written one. */
  summary: string
  /**
   * The adventure's AI instructions, which REPLACE the built-in narrator
   * prompt. Empty when it carried none, in which case the story keeps
   * following DEFAULT_SYSTEM_PROMPT as it changes.
   */
  instructions: string
  /** Human-readable notes about what was dropped or coerced. */
  warnings: string[]
}

export type BackupParseResult =
  | { ok: true; data: ParsedBackup }
  | {
      ok: false
      /**
       * Whether the file was recognisably an AI Dungeon backup that then failed
       * to read. Same contract as aidungeon.ts's: it separates "not mine" from
       * "mine, and broken", so the picker can report the right error for a zip
       * that is some other app's export.
       */
      recognised: boolean
      error: string
    }

// ---------------------------------------------------------------------------
// Archive layout
// ---------------------------------------------------------------------------

/**
 * The names are matched with a leading-path allowance because a writer who
 * unzips a backup and re-zips the folder produces `backup/metadata.json`, and
 * that archive is still plainly a backup. Case-insensitively, for the same
 * reason: the round trip may have gone through a filesystem that does not care.
 */
const METADATA_NAME = /(^|\/)metadata\.json$/i
const ACTIONS_NAME = /(^|\/)actions-(\d+)\.json$/i

function findMetadata(archive: ZipArchive): string | null {
  return archive.names.find((name) => METADATA_NAME.test(name)) ?? null
}

/**
 * The action parts, in play order.
 *
 * Sorted by the NUMBER in the filename rather than by the archive's own
 * ordering or by string comparison. The archive's order is whatever the writer
 * happened to produce, and a string sort puts `actions-10.json` between 1 and
 * 2 — which silently reorders a long adventure's middle rather than failing.
 */
function findActionParts(archive: ZipArchive): string[] {
  return archive.names
    .map((name) => {
      const match = ACTIONS_NAME.exec(name)
      return match ? { name, part: Number(match[2]) } : null
    })
    .filter((entry): entry is { name: string; part: number } => entry !== null)
    .sort((a, b) => a.part - b.part)
    .map((entry) => entry.name)
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * AI Dungeon prefixes a player turn with "> " when it renders and when it
 * prompts. draft-zero adds its own chevron at prompt time from `action_kind`
 * (lib/generation/context.ts), so a stored one would be doubled on the page and
 * in every context the passage reaches.
 */
const CHEVRON = /^\s*>\s*/

/**
 * A Say as AI Dungeon renders it. The trailing punctuation is optional and
 * outside the quotes on purpose: exports carry both `You say "Run."` and
 * `You say "Run".`, and the closing quote may be straight or curly.
 */
const RENDERED_SAY = /^you\s+say[,:]?\s*["“]([\s\S]*)["”][.!?]?\s*$/i

/**
 * The writer's input, reconstructed from AI Dungeon's rendering.
 *
 * For a Do this is the rendering itself: the text is already second-person, so
 * translateAction's pronoun shift is a no-op over it and only the capitalise-
 * and-punctuate pass has anything to do. For a Say the quoted line is unwrapped
 * first — feeding `You say "Run."` to the Say translation would produce
 * `You say, "You say "run.""`, quoting the narrator quoting the player.
 */
function toInputText(kind: ActionKind, rendered: string): string {
  if (kind !== "say") return rendered
  const quoted = RENDERED_SAY.exec(rendered)
  return quoted ? quoted[1].trim() : rendered
}

/** Action types that are prose the writer or the model committed, not a turn. */
const NARRATION_TYPES = new Set(["start", "story", "unknown", ""])

interface ReadActions {
  passages: ParsedBackupPassage[]
  /** Action types the reader had no mapping for, for the warnings. */
  unknownTypes: Set<string>
  /** How many `see` (image) actions were dropped. */
  images: number
  /** How many actions carried no text at all. */
  empty: number
}

function readActions(raw: unknown[]): ReadActions {
  const passages: ParsedBackupPassage[] = []
  const unknownTypes = new Set<string>()
  let images = 0
  let empty = 0

  for (const item of raw) {
    if (!isRecord(item)) {
      empty += 1
      continue
    }
    const type = str(item.type).trim().toLowerCase()
    const rawText = str(item.text)

    // Dropped before the empty check, so an image beat is reported as an image
    // rather than as a blank action — it is neither, and a text backup simply
    // has nowhere to put it.
    if (type === "see") {
      images += 1
      continue
    }

    // An undone-then-redone adventure leaves empty actions behind. They carry
    // nothing into the manuscript and would render as blank passages the writer
    // can only find by scrolling into them.
    if (rawText.trim() === "") {
      empty += 1
      continue
    }

    if (type === "continue") {
      passages.push({
        source: "generated",
        text: toParagraphText(rawText),
        actionKind: null,
        inputText: null,
      })
      continue
    }

    if (type === "do" || type === "say") {
      const rendered = toParagraphText(rawText.replace(CHEVRON, ""))
      const input = toInputText(type, rendered)
      const text = translateAction(type, input)
      // A turn whose translation comes out empty was punctuation or a stray
      // chevron. Keeping the rendering as narration preserves the writer's
      // words rather than dropping them over a transform that had nothing to
      // work with.
      passages.push(
        text.trim() === ""
          ? {
              source: "user",
              text: rendered,
              actionKind: null,
              inputText: null,
            }
          : { source: "user", text, actionKind: type, inputText: input }
      )
      continue
    }

    if (!NARRATION_TYPES.has(type)) unknownTypes.add(type)
    passages.push({
      source: "user",
      text: toParagraphText(rawText),
      actionKind: null,
      inputText: null,
    })
  }

  return { passages, unknownTypes, images, empty }
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

/**
 * How many entries AI Dungeon's `memories` store held — counted, and then
 * deliberately dropped.
 *
 * These are NOT the adventure's memory field. `adventure.memory` is AI
 * Dungeon's Plot Essentials, which is what draft-zero's `memory` is, and it
 * imports. `state.memories` is a different thing wearing a similar name: AI
 * Dungeon's own recall store, entries it writes and retrieves as the adventure
 * runs. draft-zero has no equivalent — the rolling recap is the nearest thing
 * and it is one rolling text, not a store — so there is nowhere honest to put
 * them.
 *
 * Appending them to memory (as this did first) is the tempting wrong answer:
 * it silently converts a retrieval store into standing context that is injected
 * into EVERY prompt, which is the one property the store exists not to have.
 * Better to drop them and say so than to import something that behaves nothing
 * like what it was.
 */
function countMemories(raw: unknown): number {
  return Array.isArray(raw) ? raw.length : 0
}

/**
 * AI Dungeon's "AI Instructions" — standing directions for how the model should
 * narrate this adventure.
 *
 * They become the story's `systemPrompt`, replacing the built-in narrator
 * prompt outright, because that is what they ARE: AI Dungeon writes them as a
 * system prompt and writers author them as one. Filing them in memory (as this
 * did first) or in the author's note puts narrator directions inside the
 * story's own context blocks, where they read as facts about the world rather
 * than as instructions to the narrator.
 *
 * KNOWN AND ACCEPTED: `systemPrompt` is a whole-prompt override, so a backup
 * carrying instructions also drops DEFAULT_SYSTEM_PROMPT — including the two
 * rules that explain what a `>` player turn is, which is the one thing this
 * importer fills a manuscript with. The cost is deliberate: the Narrator dialog
 * shows exactly what was stored, with the built-in prompt as its placeholder,
 * so a writer can see it and edit or clear it. The fix is not a smarter merge
 * here but a split in the prompt itself — the creative direction an import may
 * replace, kept apart from the mechanics of this app that it never should — and
 * when that lands this reader should not have to change.
 */
function readInstructions(raw: unknown): string {
  if (typeof raw === "string") return toLoreText(raw)
  if (!isRecord(raw)) return ""
  return toLoreText(str(raw.custom) || str(raw.scenario))
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function notABackup(error: string): BackupParseResult {
  return { ok: false, recognised: false, error }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * Reads an AI Dungeon backup archive. Never throws: a malformed or foreign zip
 * comes back as `{ ok: false }`.
 */
export async function parseBackup(
  input: ArrayBuffer | Uint8Array
): Promise<BackupParseResult> {
  let archive: ZipArchive
  try {
    archive = openZip(input, { maxInflatedBytes: MAX_BACKUP_INFLATED_BYTES })
  } catch (error) {
    return notABackup(
      error instanceof ZipError ? error.message : "That zip couldn't be opened."
    )
  }

  const metadataName = findMetadata(archive)
  if (!metadataName) {
    return notABackup("That zip isn't an AI Dungeon backup — no metadata.json.")
  }

  let metadata: unknown
  try {
    metadata = JSON.parse(await archive.readText(metadataName))
  } catch (error) {
    if (error instanceof ZipError) {
      return { ok: false, recognised: true, error: error.message }
    }
    // Recognised: the archive is laid out like a backup, so claiming it and
    // saying its metadata is broken beats handing it to a reader that would
    // find some other reason to reject it.
    return {
      ok: false,
      recognised: true,
      error: "That backup's metadata.json isn't valid JSON.",
    }
  }
  if (!isRecord(metadata)) {
    return {
      ok: false,
      recognised: true,
      error: "That backup's metadata.json isn't an AI Dungeon adventure.",
    }
  }

  const adventure = isRecord(metadata.adventure) ? metadata.adventure : {}
  const state = isRecord(metadata.state) ? metadata.state : {}
  // `adventure` is what makes this AI Dungeon's metadata.json rather than some
  // other tool's; without it the file is only coincidentally named.
  if (!isRecord(metadata.adventure)) {
    return notABackup("That zip isn't an AI Dungeon backup.")
  }

  const warnings: string[] = []

  // Cards go through the story-card reader, not a second copy of it: the type
  // vocabulary, the key splitting and the value/description merge are exactly
  // the same decisions in both formats, and two implementations of them would
  // drift into filing the same card in two categories.
  const cards = Array.isArray(state.storyCards) ? state.storyCards : []
  const read = readCards(cards, warnings)

  const parts = findActionParts(archive)
  const passages: ParsedBackupPassage[] = []
  const unknownTypes = new Set<string>()
  let images = 0
  let empty = 0

  for (const part of parts) {
    let payload: unknown
    try {
      payload = JSON.parse(await archive.readText(part))
    } catch (error) {
      // A blown budget is not a bad part, it is a bad archive, and continuing
      // would try every remaining part against a budget already spent — turning
      // one refusal into a warning per part and an import that "succeeded" with
      // most of the story missing.
      if (error instanceof ZipError) {
        return { ok: false, recognised: true, error: error.message }
      }
      // One unreadable part in the middle of an adventure is not a reason to
      // throw away the rest, but it IS a hole in the manuscript, and a hole the
      // writer cannot see is the failure worth avoiding.
      warnings.push(`"${part}" couldn't be read — those passages are missing.`)
      continue
    }
    const actions = isRecord(payload) ? payload.actions : payload
    if (!Array.isArray(actions)) {
      warnings.push(`"${part}" carried no actions.`)
      continue
    }
    const result = readActions(actions)
    passages.push(...result.passages)
    for (const type of result.unknownTypes) unknownTypes.add(type)
    images += result.images
    empty += result.empty
  }

  // A backup with neither a manuscript nor a lorebook is card-shaped in name
  // only. Importing an empty story wearing a title is worse than saying so.
  if (
    passages.length === 0 &&
    read.entries.length === 0 &&
    read.settings.length === 0
  ) {
    return {
      ok: false,
      recognised: true,
      error: "That backup has no story and no story cards in it.",
    }
  }

  // The count the backup declares against the count that arrived. They differ
  // for good reasons (dropped images, blank actions) and for bad ones (a part
  // file that never made it into the archive), and only the writer can tell
  // which — so the reader reports the gap rather than deciding it was fine.
  const declared = metadata.totalActionCount
  const declaredParts = metadata.totalParts
  if (typeof declaredParts === "number" && parts.length < declaredParts) {
    warnings.push(
      `This backup says it has ${declaredParts} action files but only ${
        parts.length
      } ${parts.length === 1 ? "is" : "are"} in the zip.`
    )
  }
  if (images > 0) {
    warnings.push(
      `Dropped ${plural(images, "image", "images")} — a backup carries the prompt but not the picture.`
    )
  }
  if (empty > 0) {
    warnings.push(`Skipped ${plural(empty, "empty action", "empty actions")}.`)
  }
  if (unknownTypes.size > 0) {
    warnings.push(
      `Unrecognised action ${
        unknownTypes.size === 1 ? "type" : "types"
      } (${[...unknownTypes].join(", ")}) ${
        unknownTypes.size === 1 ? "was" : "were"
      } imported as narration.`
    )
  }
  if (
    typeof declared === "number" &&
    declared > passages.length + images + empty
  ) {
    warnings.push(
      `This backup says it has ${declared} actions but ${passages.length + images + empty} arrived.`
    )
  }

  const instructions = readInstructions(state.instructions)
  if (instructions !== "") {
    // Said before the write, not after: replacing the narrator prompt is the
    // one thing this import does that a writer cannot infer from the story it
    // lands in, and the Narrator dialog is where they undo it.
    warnings.push(
      "The adventure's AI instructions replace the built-in narrator prompt — edit it under Narrator."
    )
  }

  // Memory, the author's note and the summary keep their own line breaks
  // (toLoreText, not toParagraphText): none of them is manuscript prose, and
  // all three reach the model verbatim inside a bracketed block. An AI Dungeon
  // memory is very often a stat block — "Name: Zach\nRace: Human" — and the
  // paragraph contract would blank-line every row of it apart. Only `passages`
  // and `description` are prose, and only they are promoted.
  const memories = countMemories(state.memories)
  if (memories > 0) {
    warnings.push(
      `Dropped ${plural(memories, "AI Dungeon memory", "AI Dungeon memories")} — there's nothing here that remembers the way that store does.`
    )
  }

  // The adventure's Plot Essentials, and only that. See countMemories.
  const memory = toLoreText(str(adventure.memory))

  return {
    ok: true,
    data: {
      title: str(adventure.title).trim() || "Imported adventure",
      description: toParagraphText(str(adventure.description)),
      memory,
      authorsNote: toLoreText(str(adventure.authorsNote)),
      tags: [...new Set(strArray(adventure.tags))],
      worldDescription: read.worldDescription,
      lorebookEntries: read.entries,
      settingEntries: read.settings,
      passages,
      summary: toLoreText(str(state.storySummary)),
      instructions,
      warnings,
    },
  }
}
