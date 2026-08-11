import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { StoryWorkspace } from "@/components/story/story-workspace"
import { getStory, listLorebookEntries } from "@/lib/db/queries"
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
  const story = await getStory(storyId)

  return {
    title: story?.title ?? "Story",
  }
}

export default async function StoryPage({ params }: StoryPageProps) {
  const { storyId } = await params
  const [story, lorebookEntries, models] = await Promise.all([
    getStory(storyId),
    listLorebookEntries(storyId),
    listModels(),
  ])

  if (!story) {
    notFound()
  }

  // No key here: the workspace keys its own editor subtree by story id, so
  // per-story state resets while the writer's UI preferences (inspector
  // visibility, composer mode) survive navigation.
  return (
    <StoryWorkspace
      story={story}
      lorebookEntries={lorebookEntries}
      models={models}
    />
  )
}
