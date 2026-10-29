// lib/spend-purpose.ts — Which ledger line each request kind's money lands on.
//
// One map, read by both sides: the cost query turns it into the CASE it groups
// by, and the ledger reads the same order and labels to draw the rows. A kind
// added to GenerationRequestKind fails to compile here until it has a line.

import type {
  GenerationRequestKind,
  SpendPart,
  SpendPurpose,
} from "@/lib/types"

export const SPEND_PART_BY_KIND: Record<GenerationRequestKind, SpendPart> = {
  generate: "take",
  continue: "take",
  retry: "reroll",
  illustrate: "image",
  "illustrate-prompt": "image-prompt",
  world: "world",
  summarize: "recap",
  atmosphere: "atmosphere",
}

export const SPEND_PURPOSE_BY_PART: Record<SpendPart, SpendPurpose> = {
  take: "story",
  reroll: "story",
  image: "pictures",
  "image-prompt": "pictures",
  world: "memory",
  recap: "memory",
  atmosphere: "atmosphere",
}

/** Row order, fixed so a purpose keeps its place and colour from story to story. */
export const SPEND_PURPOSES: readonly SpendPurpose[] = [
  "story",
  "pictures",
  "memory",
  "atmosphere",
]

export const SPEND_PARTS: readonly SpendPart[] = [
  "take",
  "reroll",
  "image",
  "image-prompt",
  "world",
  "recap",
  "atmosphere",
]

export const SPEND_PURPOSE_LABELS: Record<SpendPurpose, string> = {
  story: "Story",
  pictures: "Pictures",
  memory: "Memory",
  atmosphere: "Atmosphere",
}

export const SPEND_PART_LABELS: Record<SpendPart, string> = {
  take: "First takes",
  reroll: "Re-rolls",
  image: "Images",
  "image-prompt": "Image prompts",
  world: "World",
  recap: "Recap",
  atmosphere: "Atmosphere",
}

/** The request kinds that land on `part`, for SQL filters. */
export function kindsForPart(part: SpendPart): GenerationRequestKind[] {
  return (
    Object.entries(SPEND_PART_BY_KIND) as [GenerationRequestKind, SpendPart][]
  )
    .filter(([, p]) => p === part)
    .map(([kind]) => kind)
}
