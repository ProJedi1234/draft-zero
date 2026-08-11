import type { Metadata } from "next"

import { listLorebookEntries } from "@/lib/db/queries"

import { LorebookView } from "@/components/lorebook/lorebook-view"

export const metadata: Metadata = {
  title: "Lorebook",
}

export default async function LorebookPage() {
  const entries = await listLorebookEntries()
  return <LorebookView entries={entries} />
}
