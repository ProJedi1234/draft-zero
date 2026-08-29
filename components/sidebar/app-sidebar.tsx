"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { Feather, Search, X } from "lucide-react"

import type { ActiveRun } from "@/lib/sync/types"
import { useRunStatus } from "@/hooks/use-run-status"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInput,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { NavWorkspace } from "@/components/sidebar/nav-workspace"
import { StoryList } from "@/components/sidebar/story-list"
import { ThemeToggle } from "@/components/theme-toggle"

export function AppSidebar({
  activeRuns,
  ...props
}: {
  /** Runs in flight, from the registry. Re-arrives with every RSC payload. */
  activeRuns: ActiveRun[]
} & React.ComponentProps<typeof Sidebar>) {
  const [query, setQuery] = React.useState("")
  // The open story, read from the path rather than passed down: the sidebar
  // lives in the root layout, which does not know which story the slot below
  // it is rendering. An open story needs no mark — the writer is watching that
  // passage land in the manuscript itself.
  const pathname = usePathname()
  const openStoryId = pathname.startsWith("/story/")
    ? (pathname.split("/")[2] ?? null)
    : null
  const runStatus = useRunStatus(activeRuns, openStoryId)
  // Full-bleed on a phone, so there is no dimmed page left to tap. Picking a
  // story still dismisses it; this is the way out for someone who opened it and
  // changed their mind.
  const { isMobile, setOpenMobile } = useSidebar()

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader className="gap-4 p-3 pt-4">
        <div className="flex items-center gap-2 px-1">
          <Feather className="size-4 shrink-0" />
          <span className="text-xs font-semibold tracking-widest uppercase">
            Draft Zero
          </span>
          {isMobile ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close sidebar"
              className="-my-1 ml-auto"
              onClick={() => setOpenMobile(false)}
            >
              <X />
            </Button>
          ) : null}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <SidebarInput
            placeholder="Search stories"
            aria-label="Search stories"
            className="border-transparent bg-sidebar-accent pl-8 placeholder:text-muted-foreground/70"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("")
            }}
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavWorkspace />
        <StoryList query={query} runStatus={runStatus} />
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
