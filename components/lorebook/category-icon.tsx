import {
  CalendarClock,
  Lightbulb,
  MapPin,
  Package,
  Shield,
  Swords,
  UserRound,
  type LucideIcon,
} from "lucide-react"

import type { LorebookCategory } from "@/lib/types"
import { cn } from "@/lib/utils"

const CATEGORY_ICONS: Record<LorebookCategory, LucideIcon> = {
  character: UserRound,
  // Swords, not Shield — Shield is the faction mark, and the two sit adjacent
  // in the filter row where a near-identical glyph would be unreadable.
  class: Swords,
  location: MapPin,
  faction: Shield,
  item: Package,
  event: CalendarClock,
  concept: Lightbulb,
}

export function CategoryIcon({
  category,
  className,
}: {
  category: LorebookCategory
  className?: string
}) {
  // The fallback is load-bearing despite the type. `category` is a plain text
  // column with no CHECK constraint, and lib/db/mappers.ts casts it straight to
  // LorebookCategory without validating, so a row written by a newer build — or
  // edited by hand — arrives here as a value this build has never heard of.
  // Without the `??` that renders <undefined />, which throws "Element type is
  // invalid" and takes down the whole lorebook route rather than one row.
  const Icon = CATEGORY_ICONS[category] ?? Lightbulb
  return <Icon className={cn("size-3.5", className)} />
}
