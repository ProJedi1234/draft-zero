"use server"

import { revalidatePath } from "next/cache"

import { getDb } from "@/lib/db/client"
import { getAppSettings } from "@/lib/db/queries"
import { lorebookEntries, stories, storyEntries } from "@/lib/db/schema"
import {
  fillScenarioPlaceholders,
  MAX_SCENARIO_BYTES,
  parseScenario,
} from "@/lib/import/novelai"
import { DEFAULT_GENERATION_SETTINGS } from "@/lib/mock-data"
import type { ActionResult } from "@/lib/types"

export interface ScenarioImportSummary {
  storyId: string
  title: string
  /** How many lorebook entries came with the scenario. */
  lorebookEntryCount: number
  warnings: string[]
}

/**
 * Imports a NovelAI `.scenario` file as a new story, lorebook and all — the
 * scenario's lore belongs to the story it arrived with, which is also how
 * NovelAI stores it.
 *
 * The client parses the same bytes to render its preview, but the payload that
 * gets written is re-derived here — the action trusts the file text and the
 * placeholder values, nothing else.
 */
export async function importScenario(input: {
  /** Raw `.scenario` file text. */
  json: string
  /** Values for the scenario's `${…}` placeholders, keyed by placeholder id. */
  placeholderValues?: Record<string, string>
}): Promise<ActionResult<ScenarioImportSummary>> {
  if (input.json.length > MAX_SCENARIO_BYTES) {
    return { ok: false, error: "That file is too large to be a scenario." }
  }

  const parsed = parseScenario(input.json)
  if (!parsed.ok) return { ok: false, error: parsed.error }

  const scenario = fillScenarioPlaceholders(
    parsed.data,
    input.placeholderValues ?? {}
  )

  const db = await getDb()
  const appSettings = await getAppSettings()
  const now = new Date().toISOString()
  const storyId = crypto.randomUUID()
  const lore = scenario.lorebookEntries

  await db.transaction(async (tx) => {
    await tx.insert(stories).values({
      id: storyId,
      title: scenario.title,
      description: scenario.description,
      genre: scenario.genre,
      memory: scenario.memory,
      authorsNote: scenario.authorsNote,
      ...DEFAULT_GENERATION_SETTINGS,
      // The scenario overrides only the sampler values it can speak for; the
      // model stays the app default, since NovelAI names its own (readSettings).
      ...scenario.settings,
      modelId: appSettings.defaultModelId,
      createdAt: now,
      updatedAt: now,
    })

    if (scenario.prompt !== "") {
      // The id is minted up front because the row is its own variant group: an
      // imported prompt is a one-take slot, and every slot names itself after
      // the take that opened it.
      const promptEntryId = crypto.randomUUID()
      await tx.insert(storyEntries).values({
        id: promptEntryId,
        storyId,
        position: 0,
        variantGroupId: promptEntryId,
        variantIndex: 0,
        isActive: true,
        // The prompt is authored text, not model output — and not a player
        // turn either, so action_kind and input_text stay NULL. That is what
        // keeps the opening passage rendering verbatim instead of being read
        // as something translateAction produced.
        source: "user",
        text: scenario.prompt,
        createdAt: now,
      })
    }

    if (lore.length > 0) {
      await tx.insert(lorebookEntries).values(
        lore.map((entry) => ({
          id: crypto.randomUUID(),
          storyId,
          name: entry.name,
          category: entry.category,
          keysJson: JSON.stringify(entry.keys),
          content: entry.content,
          enabled: entry.enabled,
          alwaysActive: entry.alwaysActive,
          priority: entry.priority,
          createdAt: now,
          updatedAt: now,
        }))
      )
    }
  })

  revalidatePath("/", "layout")
  return {
    ok: true,
    data: {
      storyId,
      title: scenario.title,
      lorebookEntryCount: lore.length,
      warnings: scenario.warnings,
    },
  }
}
