// scripts/seed.ts — Destructive reseed of the database at DATABASE_URL
// (bun run db:seed). Deletes run child-first so the story_entries → stories
// foreign key holds.
// Wipes every table, then inserts the milestone-1 fixtures so the app has
// something to show. Mock `activeLorebookEntryIds` are deliberately NOT stored:
// they are recomputed at read time by real trigger matching.

import { closeDb, getDb } from "@/lib/db/client"
import {
  appSettings,
  lorebookEntries,
  storyEntries,
  stories,
} from "@/lib/db/schema"
import {
  DEFAULT_GENERATION_SETTINGS,
  MOCK_LOREBOOK_ENTRIES,
  MOCK_STORIES,
} from "@/lib/mock-data"

/**
 * Both of these belong to the Cartographer draft, but the lorebook is one global
 * collection in this milestone, so seeding them as always-active injects a river
 * god into the sci-fi and mystery stories — and hides the "no active lore" empty
 * state everywhere. Their trigger keys ("Elathe"/"river god", "debt"/"twelfth
 * map") are strong enough to activate them on the story they belong to, which is
 * what the Lore tab is meant to demonstrate. The frozen mock data is untouched;
 * per-story lorebook scoping is a later milestone.
 */
const TRIGGER_ONLY_LORE_IDS = new Set(["lore-char-elathe", "lore-concept-debt"])

async function seed() {
  const db = await getDb()

  await db.delete(storyEntries)
  await db.delete(stories)
  await db.delete(lorebookEntries)
  await db.delete(appSettings)

  let entryCount = 0

  for (const story of MOCK_STORIES) {
    await db.insert(stories).values({
      id: story.id,
      title: story.title,
      description: story.description,
      genre: story.genre,
      memory: story.memory,
      authorsNote: story.authorsNote,
      modelId: story.settings.modelId,
      temperature: story.settings.temperature,
      topP: story.settings.topP,
      maxTokens: story.settings.maxTokens,
      frequencyPenalty: story.settings.frequencyPenalty,
      presencePenalty: story.settings.presencePenalty,
      createdAt: story.createdAt,
      updatedAt: story.updatedAt,
    })

    if (story.entries.length > 0) {
      await db.insert(storyEntries).values(
        story.entries.map((entry, index) => ({
          id: entry.id,
          storyId: story.id,
          position: index,
          source: entry.source,
          text: entry.text,
          createdAt: entry.createdAt,
        }))
      )
      entryCount += story.entries.length
    }
  }

  await db.insert(lorebookEntries).values(
    MOCK_LOREBOOK_ENTRIES.map((entry) => ({
      id: entry.id,
      name: entry.name,
      category: entry.category,
      keysJson: JSON.stringify(entry.keys),
      content: entry.content,
      enabled: entry.enabled,
      alwaysActive: TRIGGER_ONLY_LORE_IDS.has(entry.id)
        ? false
        : entry.alwaysActive,
      priority: entry.priority,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }))
  )

  await db.insert(appSettings).values({
    id: 1,
    defaultModelId: DEFAULT_GENERATION_SETTINGS.modelId,
    openRouterKey: "",
  })

  console.log(
    `Seeded: ${MOCK_STORIES.length} stories, ${entryCount} entries, ${MOCK_LOREBOOK_ENTRIES.length} lorebook entries, 1 settings row.`
  )
}

// The pool holds the event loop open; close it either way or the script hangs.
seed()
  .catch((error) => {
    console.error("Seed failed:", error)
    process.exitCode = 1
  })
  .finally(closeDb)
