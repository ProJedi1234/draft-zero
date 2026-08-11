import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { getStory, listLorebookEntries } from "@/lib/db/queries"

import { LorebookView } from "@/components/lorebook/lorebook-view"

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
    <LorebookView
      storyId={story.id}
      storyTitle={story.title}
      entries={entries}
    />
  )
}
