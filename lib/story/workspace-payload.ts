// lib/story/workspace-payload.ts — Everything the story workspace mounts with,
// in one JSON-serializable object.
//
// Lifted verbatim out of the story route so the client can ask for it too: a
// story is opened far more often than it is first loaded, and a switch that
// waits on this whole graph is the lag the store was built to remove. The route
// and /api/story/[storyId]/workspace now read the same function, so the props
// a navigation paints and the props a fetch paints cannot drift.

import { getStoryCostProfile } from "@/lib/db/cost-queries"
import {
  getAppSettings,
  getComposerDraft,
  getStory,
  listLorebookEntries,
  listModelProfiles,
} from "@/lib/db/queries"
import { listModels } from "@/lib/generation/models"
import {
  getImageModelPrice,
  listImageModels,
  resolveImageModelId,
} from "@/lib/images/models"
import type {
  ComposerDraft,
  LorebookEntry,
  ModelProfile,
  OpenRouterImageModel,
  OpenRouterModel,
  Story,
  StoryCostProfile,
} from "@/lib/types"

export interface StoryWorkspacePayload {
  story: Story
  composerDraft: ComposerDraft | null
  lorebookEntries: LorebookEntry[]
  models: OpenRouterModel[]
  imageModels: OpenRouterImageModel[]
  imageModelPrice: string | null
  defaultImageModelId: string
  costProfile: StoryCostProfile
  profiles: ModelProfile[]
  defaultProfileId: string | null
  requireZdr: boolean
}

/** Null when the story does not exist — a 404 for the route, a 404 for fetch. */
export async function buildStoryWorkspacePayload(
  storyId: string
): Promise<StoryWorkspacePayload | null> {
  // Cost is read here rather than fetched by the header on open: the ledger is
  // behind a deliberate click, and a panel that answers "how much have I spent"
  // with a skeleton has wasted the gesture.
  //
  // Story-scoped only. The global summary used to be fetched alongside it, for
  // the second half of one hover line: an unscoped aggregate over the entire
  // ledger — the one cost query no index can serve — on every story open, for a
  // figure most opens never reveal. The global "where am I" figures live on
  // /usage, which the ledger links to.
  //
  // getAppSettings first, and alone: it lazily seeds the "Default" profile, so
  // a list read in parallel with it can come back empty on a fresh database.
  const settings = await getAppSettings()
  // The whole profile list, not just the followed one: the switcher is a menu,
  // and there are a handful of these rows at most (see the UX doc) — a second
  // round trip when the writer opens it would be the expensive option.
  const [
    story,
    composerDraft,
    lorebookEntries,
    models,
    imageModels,
    costProfile,
    profiles,
  ] = await Promise.all([
    getStory(storyId),
    // The unsent composer text, seeding the editor's live draft state. Only
    // the mount ever reads it — after that the `draft` bus events are the
    // channel — so a refetch delivering a newer row changes nothing.
    getComposerDraft(storyId),
    listLorebookEntries(storyId),
    listModels(),
    // Cached an hour in-process like the text catalog, so this is a lookup
    // rather than a round trip on most requests.
    listImageModels(),
    getStoryCostProfile(storyId),
    listModelProfiles(),
  ])

  if (!story) return null

  // One request, for the selected model only, and cached an hour — the image
  // catalog's list endpoint carries no pricing at all, so pricing every row
  // would be one round trip per row to fill a select nobody has opened.
  // What a null story choice resolves to, passed down so the picker's
  // "Default" row can name it without re-deriving the server's answer.
  const defaultImageModelId = await resolveImageModelId(
    null,
    story.settings.zdr
  )
  const imageModelPrice = await getImageModelPrice(
    story.imageModelId ?? defaultImageModelId
  )

  return {
    story,
    composerDraft,
    lorebookEntries,
    models,
    imageModels,
    imageModelPrice,
    defaultImageModelId,
    costProfile,
    profiles,
    defaultProfileId: settings.defaultProfileId,
    requireZdr: settings.requireZdr,
  }
}
