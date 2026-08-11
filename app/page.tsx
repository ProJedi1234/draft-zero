import { redirect } from "next/navigation"

import { DEFAULT_STORY_ID } from "@/lib/mock-data"

export default function Page() {
  redirect(`/story/${DEFAULT_STORY_ID}`)
}
