"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Gauge, Images, Library, Settings2 } from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

// No Lorebook entry: lore is scoped to a story, so it is reached from the
// story header (/story/[storyId]/lorebook), not from the global sidebar.
const items = [
  // "/" only became reachable once it stopped redirecting to a story. It needs
  // a way back from inside one — on a phone the sidebar is the only chrome
  // there is, and an installed copy has no browser back button at all.
  { title: "Library", href: "/", icon: Library },
  // Cross-story on purpose, like the library itself: a per-story gallery is a
  // different (future) surface, reached from the story rather than from here.
  { title: "Gallery", href: "/gallery", icon: Images },
  // A gauge, not a coin: this row sits in the chrome permanently, and a
  // currency glyph in a monochrome sidebar is a standing nag about money.
  { title: "Usage", href: "/usage", icon: Gauge },
  { title: "Settings", href: "/settings", icon: Settings2 },
]

export function NavWorkspace() {
  const pathname = usePathname()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Workspace</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                // "/" prefixes every route, so it has to match exactly or the
                // Library row lights up on every page.
                isActive={
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href)
                }
                render={<Link href={item.href} />}
              >
                <item.icon />
                {item.title}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
