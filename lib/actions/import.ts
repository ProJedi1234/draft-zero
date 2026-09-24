"use server"

import * as importer from "@/lib/services/import"
import type {
  BackupImportSummary,
  ScenarioImportSummary,
  StoryCardImportSummary,
  StoryCardMergeSummary,
} from "@/lib/services/import.schema"
import type { ActionResult } from "@/lib/types"

// Server actions are unauthenticated POST endpoints whose arguments arrive
// unvalidated, so the declared types below are a hope; the service parses them.

export async function importScenario(input: {
  /** Raw `.scenario` file text. */
  json: string
  /** Values for the scenario's `${…}` placeholders, keyed by placeholder id. */
  placeholderValues?: Record<string, string>
}): Promise<ActionResult<ScenarioImportSummary>> {
  return importer.importScenario(input, { origin: null })
}

export async function importStoryCards(input: {
  /** Raw export file text. */
  json: string
}): Promise<ActionResult<StoryCardImportSummary>> {
  return importer.importStoryCards(input, { origin: null })
}

export async function importAiDungeonBackup(input: {
  /** The raw `.zip` backup. */
  file: File
}): Promise<ActionResult<BackupImportSummary>> {
  return importer.importAiDungeonBackup(input, { origin: null })
}

export async function importStoryCardsIntoStory(input: {
  storyId: string
  /** Raw export file text. */
  json: string
}): Promise<ActionResult<StoryCardMergeSummary>> {
  return importer.importStoryCardsIntoStory(input, { origin: null })
}
