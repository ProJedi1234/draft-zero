import type { Metadata } from "next"

import { getStoryTitle } from "@/lib/db/queries"

import { LorebookLoader } from "@/components/lorebook/lorebook-loader"

type LorebookPageProps = {
  params: Promise<{ storyId: string }>
}

export async function generateMetadata({
  params,
}: LorebookPageProps): Promise<Metadata> {
  const { storyId } = await params
  const title = await getStoryTitle(storyId)

  return {
    title: title ? `${title} · Lorebook` : "Lorebook",
  }
}

/**
 * Deliberately empty of data, exactly like the story route beside it.
 *
 * This page used to await getStory + listLorebookEntries and serialize every
 * entry into the navigation — 290KB of RSC payload on a big lorebook, which is
 * time the writer spends looking at the story they just left. The entries are
 * already in the client store by then: the workspace payload the story route
 * fetched carries them, and the store holds them across a relaunch. So the
 * route carries nothing and the shell paints from memory.
 *
 * The tint moves into the shell for the same reason it is client-rendered on
 * the story route — the atmosphere slider's optimistic value lives in the
 * store, and a server-rendered tint would fight it.
 */
export default async function LorebookPage({ params }: LorebookPageProps) {
  const { storyId } = await params

  return <LorebookLoader storyId={storyId} />
}
