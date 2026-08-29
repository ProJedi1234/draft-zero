// scripts/seed.ts — Destructive reseed of the database at DATABASE_URL
// (bun run db:seed). Deletes run child-first so the story_entries → stories and
// lorebook_entries → stories foreign keys hold.
// Wipes every table, then inserts the milestone-1 fixtures so the app has
// something to show. Mock `activeLorebookEntryIds` are deliberately NOT stored:
// they are recomputed at read time by real trigger matching.

import { mkdir, writeFile } from "node:fs/promises"

import { closeDb, getDb } from "@/lib/db/client"
import {
  appSettings,
  lorebookEntries,
  modelProfiles,
  storyEntries,
  storyImages,
  stories,
} from "@/lib/db/schema"
import {
  MOCK_ILLUSTRATIONS,
  DEFAULT_GENERATION_SETTINGS,
  MOCK_LOREBOOK_ENTRIES,
  MOCK_STORIES,
} from "@/lib/mock-data"
import {
  MOCK_IMAGE_MEDIA_TYPE,
  MockImageProvider,
} from "@/lib/images/mock-provider"
import { imageFilePath, IMAGE_DIR } from "@/lib/images/blob-path"

/**
 * The final frame the offline mock draws for a seed, with the shimmer skipped.
 *
 * The same provider the app uses rather than a second renderer, so a seeded
 * picture and a drawn one are the same kind of object — and no SVGs are checked
 * into the repo, which would only be caching something a seed already
 * determines.
 */
const FIXTURE_PROVIDER = new MockImageProvider({
  initialDelayMs: 0,
  partialDelayMs: 0,
  partialCount: 0,
})

async function renderFixtureImage(
  seed: number,
  modelId: string,
  aspectRatio: (typeof MOCK_ILLUSTRATIONS)[number]["aspectRatio"]
): Promise<string> {
  for await (const event of FIXTURE_PROVIDER.generate({
    prompt: "",
    modelId,
    zdr: false,
    aspectRatio,
    seed,
  })) {
    if (event.type === "completed") return event.b64
  }
  throw new Error(`mock provider produced no image for seed ${seed}`)
}

async function seed() {
  const db = await getDb()

  await db.delete(storyImages)
  await db.delete(storyEntries)
  await db.delete(lorebookEntries)
  await db.delete(stories)
  await db.delete(appSettings)
  // Wiped alongside app_settings: a leftover profile would stop getAppSettings
  // from lazily seeding the default that the fresh settings row points at.
  await db.delete(modelProfiles)

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
      thinking: story.settings.thinking,
      providerTag: story.settings.providerTag,
      temperature: story.settings.temperature,
      topP: story.settings.topP,
      contextWindow: story.settings.contextWindow,
      loreBudget: story.settings.loreBudget,
      frequencyPenalty: story.settings.frequencyPenalty,
      presencePenalty: story.settings.presencePenalty,
      tintHue: story.tintHue,
      tintStrength: story.tintStrength,
      createdAt: story.createdAt,
      updatedAt: story.updatedAt,
    })

    if (story.entries.length > 0) {
      await db.insert(storyEntries).values(
        // The fixtures are all prose, so action_kind and input_text are left
        // unset and land as NULL — none of these passages is a Say or a Do.
        // Every fixture is likewise a one-take slot: the group is named after
        // the entry itself, which is the same shape the migration backfills
        // onto pre-existing rows, so seeded and migrated stories read alike.
        // Positions step by two, leaving the odd numbers free for the seeded
        // illustrations to sit BETWEEN passages. The sequence is shared with
        // story_images and gaps in it cost nothing — nextStoryPosition is
        // MAX + 1 — so this is the cheapest way for the fixtures to show what
        // an illustration actually is: a beat in the manuscript, not a
        // postscript stacked at the bottom.
        story.entries.map((entry, index) => ({
          id: entry.id,
          storyId: story.id,
          position: index * 2,
          variantGroupId: entry.id,
          variantIndex: 0,
          isActive: true,
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

  // Illustrations last: the bytes land on disk beside the row, and a row whose
  // file is missing is the one state the image route cannot recover from.
  let takeCount = 0
  for (const slot of MOCK_ILLUSTRATIONS) {
    for (const [takeIndex, seed] of slot.seeds.entries()) {
      const id = `${slot.imageGroupId}-take-${takeIndex}`
      // Written here rather than through lib/images/store, which is
      // `server-only` and throws the moment a plain script imports it. The path
      // arithmetic is shared, so a seeded blob still lands exactly where the
      // image route will look for it.
      await mkdir(IMAGE_DIR, { recursive: true })
      await writeFile(
        imageFilePath(id, MOCK_IMAGE_MEDIA_TYPE),
        Buffer.from(
          await renderFixtureImage(seed, slot.modelId, slot.aspectRatio),
          "base64"
        )
      )
      await db.insert(storyImages).values({
        id,
        storyId: slot.storyId,
        position: slot.position,
        imageGroupId: slot.imageGroupId,
        imageIndex: takeIndex,
        isActive: takeIndex === slot.activeTake,
        prompt: slot.prompt,
        sourcePrompt: slot.sourcePrompt,
        // No lore ids: these were never developed by a real call, and a list of
        // entry ids here would claim a provenance that does not exist.
        promptLoreIdsJson: null,
        modelId: slot.modelId,
        aspectRatio: slot.aspectRatio,
        seed,
        mediaType: MOCK_IMAGE_MEDIA_TYPE,
        // Retries land a few minutes after the draw they replace.
        createdAt: new Date(
          Date.parse(slot.createdAt) + takeIndex * 4 * 60_000
        ).toISOString(),
      })
      takeCount += 1
    }
  }

  await db.insert(appSettings).values({
    id: 1,
    defaultModelId: DEFAULT_GENERATION_SETTINGS.modelId,
    defaultThinking: DEFAULT_GENERATION_SETTINGS.thinking,
  })

  console.log(
    `Seeded: ${MOCK_STORIES.length} stories, ${entryCount} entries, ${MOCK_LOREBOOK_ENTRIES.length} lorebook entries, ${MOCK_ILLUSTRATIONS.length} illustrations (${takeCount} draws), 1 settings row.`
  )
}

// The pool holds the event loop open; close it either way or the script hangs.
seed()
  .catch((error) => {
    console.error("Seed failed:", error)
    process.exitCode = 1
  })
  .finally(closeDb)
