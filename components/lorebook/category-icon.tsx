import {
  CalendarClock,
  Lightbulb,
  MapPin,
  Package,
  Shield,
  UserRound,
  type LucideIcon,
} from "lucide-react"

import type { LorebookCategory } from "@/lib/types"
import { cn } from "@/lib/utils"

const CATEGORY_ICONS: Record<LorebookCategory, LucideIcon> = {
  character: UserRound,
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
  const Icon = CATEGORY_ICONS[category]
  return <Icon className={cn("size-3.5", className)} />
}
