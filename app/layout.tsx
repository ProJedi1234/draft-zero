import type { Metadata, Viewport } from "next"
import { Geist_Mono, Inter, Source_Serif_4 } from "next/font/google"

import "./globals.css"
import { AppSidebar } from "@/components/sidebar/app-sidebar"
import { SyncListener } from "@/components/sync-listener"
import { StatusBarTint } from "@/components/status-bar-tint"
import { ThemeProvider } from "@/components/theme-provider"
import { ViewportHeightSync } from "@/components/viewport-height-sync"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { listActiveRuns } from "@/lib/generation/live"
import { listActiveImageRuns } from "@/lib/images/live"
import { listStories } from "@/lib/db/queries"
import { cn } from "@/lib/utils"

const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
})

const fontSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: {
    default: "draft zero",
    template: "%s · draft zero",
  },
  description: "A local-first studio for AI-assisted fiction.",
  /*
   * Was `black-translucent`, to paint the app under the status bar. That is
   * what stranded the bottom edge: iOS hands the web view the full screen but a
   * layout viewport still sized to screen-minus-status-bar, so anything sized
   * to the screen (100dvh, min-h-svh) is taller than the document that holds
   * it. The overflow let the shell scroll up, taking the composer off the
   * bottom of the screen while the manuscript kept painting underneath it — and
   * because whether it happened depended on iOS's per-launch geometry, it came
   * and went at random. Two rounds of fixes treated symptoms of this.
   *
   * Under `default` the web view starts below the status bar, the two viewports
   * agree, and there is nothing left to displace.
   *
   * Cost: no bleed under the clock, so the strip is a flat theme-color band. It
   * matches --background, which is what sits below it in the ordinary case.
   *
   * iOS reads this at Add-to-Home-Screen time — changing it does nothing to an
   * already-installed copy until the icon is deleted and re-added.
   */
  appleWebApp: {
    capable: true,
    title: "draft zero",
    statusBarStyle: "default",
  },
}

/**
 * Edge-to-edge on iOS: without viewport-fit=cover, Safari letterboxes the page
 * above its bottom toolbar with a hard edge. With it, the app paints under the
 * translucent bars and safe-area insets (h-app, the composer) keep controls
 * clear of them.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Two entries, not one: installed on iOS the status bar area is painted with
  // this colour, and a single value would leave the bar light while the app is
  // dark. Both match --background in globals.css.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
}

/**
 * Root-layout segment config: every route renders per request, so the database
 * is read at request time and nothing DB-backed is ever prerendered.
 */
export const dynamic = "force-dynamic"

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const storyPage = await listStories()
  // Synchronous and in-process — the registries are Maps on globalThis, not
  // queries. Read here rather than inside listStories because it is not
  // database state: a run lives and dies with this server, and folding it into
  // the read layer would put a fact with no row in it behind a Postgres round
  // trip. Both kinds merged, because to the library "working" is one state —
  // a story drawing a picture is busy in exactly the way one streaming prose
  // is, and the mark does not owe the reader the distinction.
  const activeRuns = [...listActiveRuns(), ...listActiveImageRuns()]

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "font-sans antialiased",
        fontSans.variable,
        fontSerif.variable,
        fontMono.variable
      )}
    >
      <body>
        <ThemeProvider>
          <SidebarProvider>
            {/* Inside the provider: it tints the status bar from the sheet's
                open state, which only exists in this context. */}
            <StatusBarTint />
            <AppSidebar storyPage={storyPage} activeRuns={activeRuns} />
            <SidebarInset>{children}</SidebarInset>
          </SidebarProvider>
          <Toaster />
          <ViewportHeightSync />
          <SyncListener />
        </ThemeProvider>
      </body>
    </html>
  )
}
