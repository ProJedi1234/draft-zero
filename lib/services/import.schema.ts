// lib/services/import.schema.ts — The importers' request and response contract.
// Isomorphic: the MAX_* caps come from the readers, which are pure and already
// run in the browser, so a contract package can lift this file with them.
import { z } from "zod"

import { MAX_CARDS_BYTES } from "@/lib/import/aidungeon"
import { MAX_BACKUP_BYTES } from "@/lib/import/aidungeon-backup"
import { MAX_SCENARIO_BYTES } from "@/lib/import/novelai"
import { entityId } from "@/lib/services/schema"

const NOT_A_FILE = "That import didn't arrive as a file."

/** Shared with the backup route, which refuses on Content-Length before reading. */
export const BACKUP_TOO_LARGE = "That backup is too large to import."

/**
 * Raw export text, capped in BYTES via TextEncoder. `String.length` counts
 * UTF-16 code units, which undercounts every non-ASCII export — a CJK file
 * weighs about three bytes per unit, so a `.length` test labelled in bytes
 * passes files three times over the limit. And a non-string payload (a
 * pre-parsed array, say) has a `.length` that is an element count, which sails
 * under any byte ceiling and then reaches the reader's object path directly.
 */
function fileText(maxBytes: number) {
  return z
    .string({ error: NOT_A_FILE })
    .refine(
      (text) => new TextEncoder().encode(text).length <= maxBytes,
      "That file is too large to be an export."
    )
}

const placeholderText = z.string({ error: "Placeholder values must be text." })

/** Keys are ordered as the old actions checked them; see parseInput. */
export const importScenarioInput = z.object({
  /** Raw `.scenario` file text. */
  json: fileText(MAX_SCENARIO_BYTES),
  /** Values for the scenario's `${…}` placeholders, keyed by placeholder id. */
  placeholderValues: z
    .record(z.string(), placeholderText, {
      error: "Placeholder values must be text.",
    })
    .default({}),
})

export const importStoryCardsInput = z.object({
  /** Raw export file text. */
  json: fileText(MAX_CARDS_BYTES),
})

export const importStoryCardsIntoStoryInput = z.object({
  // The file was checked before the story in the old action, so it still is.
  json: fileText(MAX_CARDS_BYTES),
  storyId: entityId("Invalid story id."),
})

export const importBackupInput = z.object({
  // `size` is read before any bytes are, so an oversized archive is refused
  // without ever being held in memory.
  file: z
    .instanceof(File, { error: NOT_A_FILE })
    .refine((file) => file.size <= MAX_BACKUP_BYTES, BACKUP_TOO_LARGE),
})

export interface ScenarioImportSummary {
  storyId: string
  title: string
  /** How many lorebook entries came with the scenario. */
  lorebookEntryCount: number
  warnings: string[]
}

export interface StoryCardImportSummary {
  storyId: string
  title: string
  /** How many cards became lorebook entries. */
  lorebookEntryCount: number
  warnings: string[]
}

export interface BackupImportSummary {
  storyId: string
  title: string
  /** How many passages the manuscript arrived with. */
  passageCount: number
  /** How many cards became lorebook entries. */
  lorebookEntryCount: number
  warnings: string[]
}

export interface StoryCardMergeSummary {
  storyId: string
  /** How many cards were added to the lorebook. */
  lorebookEntryCount: number
  /** How many were left alone because the story already had that name. */
  skippedCount: number
  warnings: string[]
}

export const scenarioImportOutput = z.object({
  storyId: z.string(),
  title: z.string(),
  lorebookEntryCount: z.number(),
  warnings: z.array(z.string()),
})

export const storyCardImportOutput = scenarioImportOutput

export const backupImportOutput = z.object({
  storyId: z.string(),
  title: z.string(),
  passageCount: z.number(),
  lorebookEntryCount: z.number(),
  warnings: z.array(z.string()),
})

export const storyCardMergeOutput = z.object({
  storyId: z.string(),
  lorebookEntryCount: z.number(),
  skippedCount: z.number(),
  warnings: z.array(z.string()),
})

export type ImportScenarioInput = z.input<typeof importScenarioInput>
export type ImportStoryCardsInput = z.input<typeof importStoryCardsInput>
export type ImportStoryCardsIntoStoryInput = z.input<
  typeof importStoryCardsIntoStoryInput
>
export type ImportBackupInput = z.input<typeof importBackupInput>
