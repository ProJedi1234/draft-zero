import type { Metadata } from "next"

import { StoryWorkspaceLoader } from "@/components/story/story-workspace-loader"
import { getStoryTitle } from "@/lib/db/queries"

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

/**
 * Deliberately empty of data. The workspace's props used to be read here, which
 * meant every switch between two stories waited on eight queries before the
 * screen could change; they are fetched by the shell now, against a cache that
 * usually already holds them.
 *
 * `revision` is the one thing this render contributes. Every router.refresh()
 * in the app — a generation settling, undo/redo, a lorebook write, a sync
 * `change` from another device — re-renders this route, and a value that
 * differs each time is what tells the shell to re-read the payload. That keeps
 * every existing refresh path working without teaching each of them about the
 * fetch that replaced their props.
 *
 * No key on the loader: the workspace keys its own editor subtree by story id,
 * so per-story state resets while the writer's UI preferences (inspector
 * visibility) survive navigation.
 */
export default async function StoryPage({ params }: StoryPageProps) {
  const { storyId } = await params

  return (
    <StoryWorkspaceLoader
      storyId={storyId}
      revision={await serverRenderToken()}
    />
  )
}

/**
 * A value that differs on every server render, which is the entire signal.
 *
 * Outside the component on purpose: read inline it trips react-hooks/purity,
 * a rule about client components re-rendering unpredictably. This route only
 * ever runs on the server, where "a new value per render" is the requirement
 * rather than the bug.
 */
async function serverRenderToken(): Promise<string> {
  return `${Date.now()}`
}
