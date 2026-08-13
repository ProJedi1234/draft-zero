import type { Metadata, Viewport } from "next"
import { Geist_Mono, Inter, Source_Serif_4 } from "next/font/google"

import "./globals.css"
import { AppSidebar } from "@/components/sidebar/app-sidebar"
import { ThemeProvider } from "@/components/theme-provider"
import { ViewportHeightSync } from "@/components/viewport-height-sync"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
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
   * `black-translucent` is what lets the app paint under the status bar.
   *
   * viewport-fit=cover alone is not enough when installed: under the default
   * status bar style iOS hands the web view a viewport that *starts* below the
   * status bar and fills the strip itself, so safe-area-inset-top is 0 and the
   * sidebar's background stops in a hard line under the clock — the tell that
   * this is a web page in a frame rather than an app. A single theme_color
   * cannot paper over it either: the strip spans a sidebar and a content pane
   * that are deliberately different colours, so whichever one it matched would
   * be wrong above the other.
   *
   * With this, the web view becomes full-height, the inset turns non-zero, and
   * the panels below pad themselves so their backgrounds bleed up while their
   * contents stay clear of the clock.
   *
   * Cost: iOS draws the status bar glyphs in white for this style regardless of
   * what is behind them, which is fine over the dark theme's sidebar and poor
   * over the light one's near-white. Worth checking in light mode on device.
   */
  appleWebApp: {
    capable: true,
    title: "draft zero",
    statusBarStyle: "black-translucent",
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
  const stories = await listStories()

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
            <AppSidebar stories={stories} />
            <SidebarInset>{children}</SidebarInset>
          </SidebarProvider>
          <Toaster />
          <ViewportHeightSync />
        </ThemeProvider>
      </body>
    </html>
  )
}
