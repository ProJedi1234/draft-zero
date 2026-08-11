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
