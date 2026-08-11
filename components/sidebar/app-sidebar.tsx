"use client"

import * as React from "react"
import { Feather, Search } from "lucide-react"

import { MOCK_STORIES } from "@/lib/mock-data"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInput,
  SidebarRail,
} from "@/components/ui/sidebar"
import { NavWorkspace } from "@/components/sidebar/nav-workspace"
import { StoryList } from "@/components/sidebar/story-list"
import { ThemeToggle } from "@/components/theme-toggle"

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader className="gap-4 p-3 pt-4">
        <div className="flex items-center gap-2 px-1">
          <Feather className="size-4 shrink-0" />
          <span className="text-xs font-semibold tracking-widest uppercase">
            Draft Zero
          </span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <SidebarInput
            placeholder="Search stories"
            aria-label="Search stories"
            className="border-transparent bg-sidebar-accent pl-8 placeholder:text-muted-foreground/70"
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <StoryList stories={MOCK_STORIES} />
        <NavWorkspace />
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-xs text-muted-foreground">
            v0.1 · local-first
          </span>
          <ThemeToggle />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
