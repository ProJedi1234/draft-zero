// scripts/seed.ts — Destructive reseed of the database at DATABASE_URL
// (bun run db:seed). Deletes run child-first so the story_entries → stories and
// lorebook_entries → stories foreign keys hold.
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

async function seed() {
  const db = await getDb()

  await db.delete(storyEntries)
  await db.delete(lorebookEntries)
  await db.delete(stories)
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
      storyId: entry.storyId,
      name: entry.name,
      category: entry.category,
      keysJson: JSON.stringify(entry.keys),
      content: entry.content,
      enabled: entry.enabled,
      alwaysActive: entry.alwaysActive,
      priority: entry.priority,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }))
  )

  await db.insert(appSettings).values({
    id: 1,
    defaultModelId: DEFAULT_GENERATION_SETTINGS.modelId,
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
