"use client"

import * as React from "react"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"

import { loadStoryPage } from "@/lib/actions/stories"
import type { StoryPage } from "@/lib/db/queries"
import type { StorySummary } from "@/lib/types"
import type { RunStatus } from "@/hooks/use-run-status"
import { Button } from "@/components/ui/button"
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@/components/ui/sidebar"
import { ImportScenarioButton } from "@/components/sidebar/import-scenario-button"
import {
  NewStoryButton,
  useCreateStory,
} from "@/components/sidebar/new-story-button"
import { StoryListItem } from "@/components/sidebar/story-list-item"

/** How long the box sits still before the search reaches Postgres. */
const SEARCH_DEBOUNCE_MS = 250

/**
 * First occurrence wins. The server's first page re-arrives with every RSC
 * payload while the pages loaded below it do not, so a story bumped to the top
 * by a finished run appears in both — and the fresh copy is the one to keep.
 */
function dedupeById(rows: StorySummary[]): StorySummary[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })
}

export function StoryList({
  page,
  query,
  runStatus,
}: {
  /** The first window of the library, from the root layout. */
  page: StoryPage
  query: string
  /** What each story is doing — see hooks/use-run-status.ts. */
  runStatus: (storyId: string) => RunStatus
}) {
  const { createNewStory, isPending } = useCreateStory()
  const trimmedQuery = query.trim()

  // Everything this component fetched, tagged with the query it answers: the
  // pages below the first one while browsing, and the whole result while
  // searching — a search has no server-sent page to build on, because the
  // layout's read has no idea what was typed. Tagged rather than cleared on
  // every keystroke so that a stale result is ignored by derivation instead of
  // by a second render.
  const [fetched, setFetched] = React.useState<{
    query: string
    stories: StorySummary[]
    hasMore: boolean
  }>({ query: "", stories: [], hasMore: false })
  const [isLoadingMore, startLoadingMore] = React.useTransition()

  const isCurrent = fetched.query === trimmedQuery
  // An empty box always has the layout's first page to fall back on, so it is
  // never "searching"; a typed one shows nothing until its own answer lands.
  const isSearching = trimmedQuery !== "" && !isCurrent
  const visible = React.useMemo(
    () =>
      dedupeById([
        ...(trimmedQuery === "" ? page.stories : []),
        ...(isCurrent ? fetched.stories : []),
      ]),
    [trimmedQuery, page.stories, isCurrent, fetched.stories]
  )
  // Untouched first page: the server's answer is the current one. Once
  // something has been fetched for this query, that fetch owns it.
  const untouched =
    trimmedQuery === "" && !(isCurrent && fetched.stories.length > 0)
  const hasMore = untouched ? page.hasMore : fetched.hasMore

  React.useEffect(() => {
    if (trimmedQuery === "" || isCurrent) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const res = await loadStoryPage({ offset: 0, query: trimmedQuery })
      if (cancelled) return
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setFetched({
        query: trimmedQuery,
        stories: res.data.stories,
        hasMore: res.data.hasMore,
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmedQuery, isCurrent])

  function loadMore() {
    startLoadingMore(async () => {
      const res = await loadStoryPage({
        offset: visible.length,
        query: trimmedQuery,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setFetched((prev) => ({
        query: trimmedQuery,
        stories: [
          ...(prev.query === trimmedQuery ? prev.stories : []),
          ...res.data.stories,
        ],
        hasMore: res.data.hasMore,
      }))
    })
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Library</SidebarGroupLabel>
      <SidebarGroupAction
        title="New story"
        onClick={createNewStory}
        disabled={isPending}
      >
        {isPending ? <Loader2 className="animate-spin" /> : <Plus />}
        <span className="sr-only">New story</span>
      </SidebarGroupAction>
      <ImportScenarioButton />
      <SidebarGroupContent>
        {visible.length === 0 ? (
          isSearching ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              Searching…
            </p>
          ) : trimmedQuery !== "" ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No matches for “{trimmedQuery}”
            </p>
          ) : (
            <div className="px-2 py-6 text-center">
              <p className="text-xs text-muted-foreground">No stories yet.</p>
              <NewStoryButton variant="outline" size="xs" className="mt-3" />
            </div>
          )
        ) : (
          <>
            <SidebarMenu>
              {visible.map((story) => (
                <StoryListItem
                  key={story.id}
                  story={story}
                  run={runStatus(story.id)}
                />
              ))}
            </SidebarMenu>
            {hasMore ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="mt-1 w-full text-muted-foreground"
                disabled={isLoadingMore}
                onClick={loadMore}
              >
                {isLoadingMore ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : null}
                Load more
              </Button>
            ) : null}
          </>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
