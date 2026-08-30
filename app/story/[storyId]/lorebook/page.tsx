import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { getStory, listLorebookEntries } from "@/lib/db/queries"

import { LorebookView } from "@/components/lorebook/lorebook-view"
import { StoryTint } from "@/components/story/story-tint"

type LorebookPageProps = {
  params: Promise<{ storyId: string }>
}

export async function generateMetadata({
  params,
}: LorebookPageProps): Promise<Metadata> {
  const { storyId } = await params
  const story = await getStory(storyId)

  return {
    title: story ? `${story.title} · Lorebook` : "Lorebook",
  }
}

export default async function LorebookPage({ params }: LorebookPageProps) {
  const { storyId } = await params
  const [story, entries] = await Promise.all([
    getStory(storyId),
    listLorebookEntries(storyId),
  ])

  if (!story) {
    notFound()
  }

  return (
    <>
      {/* The lorebook is still inside the story, so it wears the story's
          colour — see StoryTint. Rendered here rather than in a shared layout
          because the workspace's copy is fed by the client store, where the
          atmosphere slider's optimistic value lives. */}
      <StoryTint hue={story.tintHue} strength={story.tintStrength} />
      <LorebookView
        storyId={story.id}
        storyTitle={story.title}
        entries={entries}
      />
    </>
  )
}
