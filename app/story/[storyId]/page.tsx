import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { StoryWorkspace } from "@/components/story/story-workspace"
import { getStoryById, MOCK_STORIES } from "@/lib/mock-data"

type StoryPageProps = {
  params: Promise<{ storyId: string }>
}

export function generateStaticParams() {
  return MOCK_STORIES.map((story) => ({ storyId: story.id }))
}

export async function generateMetadata({
  params,
}: StoryPageProps): Promise<Metadata> {
  const { storyId } = await params

  return {
    title: getStoryById(storyId)?.title ?? "Story",
  }
}

export default async function StoryPage({ params }: StoryPageProps) {
  const { storyId } = await params
  const story = getStoryById(storyId)

  if (!story) {
    notFound()
  }

  return <StoryWorkspace story={story} />
}
