"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Settings2 } from "lucide-react"

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
const items = [{ title: "Settings", href: "/settings", icon: Settings2 }]

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
                isActive={pathname.startsWith(item.href)}
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
