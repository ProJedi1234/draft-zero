import { redirect } from "next/navigation"
import { Feather } from "lucide-react"

import { NewStoryButton } from "@/components/sidebar/new-story-button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { listStories } from "@/lib/db/queries"

export default async function Page() {
  const stories = await listStories()

  // The home route always lands on the story you touched last.
  if (stories[0]) redirect(`/story/${stories[0].id}`)

  return (
    <div className="flex h-app items-center justify-center">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Feather />
          </EmptyMedia>
          <EmptyTitle>Write your first story</EmptyTitle>
          <EmptyDescription>
            draft zero keeps everything on this machine. Start a draft and the
            library builds itself.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <NewStoryButton size="sm" />
        </EmptyContent>
      </Empty>
    </div>
  )
}
