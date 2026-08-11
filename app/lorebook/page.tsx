import type { Metadata } from "next"

import { LorebookView } from "@/components/lorebook/lorebook-view"

export const metadata: Metadata = {
  title: "Lorebook",
}

export default function LorebookPage() {
  return <LorebookView />
}
