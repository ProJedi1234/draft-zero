import type { Metadata } from "next"
import { Geist_Mono, Inter, Source_Serif_4 } from "next/font/google"

import "./globals.css"
import { AppSidebar } from "@/components/sidebar/app-sidebar"
import { ThemeProvider } from "@/components/theme-provider"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased font-sans",
        fontSans.variable,
        fontSerif.variable,
        fontMono.variable
      )}
    >
      <body>
        <ThemeProvider>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>{children}</SidebarInset>
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
