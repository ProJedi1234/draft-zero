"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"

import { createStory } from "@/lib/actions/stories"
import { Button } from "@/components/ui/button"

/**
 * Shared create-story transition: creates a story and navigates to it.
 * Used by `NewStoryButton` and by the sidebar's "+" group action.
 */
export function useCreateStory(): {
  createNewStory: () => void
  isPending: boolean
} {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  const createNewStory = React.useCallback(() => {
    startTransition(async () => {
      const res = await createStory()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      router.push(`/story/${res.data.id}`)
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
  variant?: "default" | "outline"
  size?: "xs" | "sm"
  className?: string
}) {
  const { createNewStory, isPending } = useCreateStory()

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
