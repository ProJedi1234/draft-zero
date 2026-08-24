import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { StoryWorkspace } from "@/components/story/story-workspace"
import { getStoryCostProfile } from "@/lib/db/cost-queries"
import {
  getAppSettings,
  getStory,
  getStoryTitle,
  listLorebookEntries,
  listModelProfiles,
} from "@/lib/db/queries"
import { listModels } from "@/lib/generation/models"

type StoryPageProps = {
  params: Promise<{ storyId: string }>
}

// No generateStaticParams: the root layout forces dynamic rendering, so DB
// content is read per request and never prerendered.

export async function generateMetadata({
  params,
}: StoryPageProps): Promise<Metadata> {
  const { storyId } = await params
  const title = await getStoryTitle(storyId)

  return {
    title: title ?? "Story",
  }
}

export default async function StoryPage({ params }: StoryPageProps) {
  const { storyId } = await params
  // Cost is read here rather than fetched by the header on open: the ledger is
  // behind a deliberate click, and a panel that answers "how much have I spent"
  // with a skeleton has wasted the gesture. revalidatePath after every entry
  // mutation keeps these figures honest without a client fetch.
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
  const [story, lorebookEntries, models, costProfile, profiles] =
    await Promise.all([
      getStory(storyId),
      listLorebookEntries(storyId),
      listModels(),
      getStoryCostProfile(storyId),
      listModelProfiles(),
    ])

  if (!story) {
    notFound()
  }

  // No key here: the workspace keys its own editor subtree by story id, so
  // per-story state resets while the writer's UI preferences (inspector
  // visibility, the armed Say/Do move) survive navigation.
  return (
    <StoryWorkspace
      story={story}
      lorebookEntries={lorebookEntries}
      models={models}
      costProfile={costProfile}
      profiles={profiles}
      defaultProfileId={settings.defaultProfileId}
      requireZdr={settings.requireZdr}
    />
  )
}
