"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"

import { startStoryCreate } from "@/lib/store/story-mutations"
import { Button } from "@/components/ui/button"

/**
 * Shared create-story transition: creates a story and navigates to it.
 * Used by `NewStoryButton` and by the sidebar's "+" group action.
 *
 * Both happen at once. The id is minted on the client, so the route is known
 * before the insert is even sent, and the workspace shell paints the ghost row
 * the store already holds — a create that waited for the commit spent a second
 * on a screen that had nothing left to learn.
 */
export function useCreateStory(): {
  createNewStory: () => void
  isPending: boolean
} {
  const router = useRouter()
  const [isPending, setIsPending] = React.useState(false)

  const createNewStory = React.useCallback(() => {
    const { id, settled } = startStoryCreate()
    setIsPending(true)
    router.push(`/story/${id}`)

    void settled.then((res) => {
      setIsPending(false)
      // The row rolls back on failure, so the shell's retry ends in the route's
      // own not-found rather than a workspace that never fills.
      if (!res.ok) toast.error(res.error)
    })
  }, [router])

  return { createNewStory, isPending }
}

/**
 * The single "New story" affordance: creates a story, then opens it.
 * Consumed by the sidebar (empty library) and the empty-home landing.
 */
export function NewStoryButton({
  variant = "default",
  size = "sm",
  className,
}: {
  /** "icon" is the library header's unlabelled affordance. */
  variant?: "default" | "outline" | "icon"
  size?: "xs" | "sm"
  className?: string
}) {
  const { createNewStory, isPending } = useCreateStory()

  if (variant === "icon") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="New story"
        className={className}
        disabled={isPending}
        onClick={createNewStory}
      >
        {isPending ? <Loader2 className="animate-spin" /> : <Plus />}
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={isPending}
      onClick={createNewStory}
    >
      {isPending ? (
        <Loader2 data-icon="inline-start" className="animate-spin" />
      ) : (
        <Plus data-icon="inline-start" />
      )}
      New story
    </Button>
  )
}
