import type { MetadataRoute } from "next"

/**
 * Web app manifest — the thing that makes an installed copy behave like an app
 * rather than a bookmark.
 *
 * `start_url` is the load-bearing member here. iOS's "Add to Home Screen" sheet
 * saves whatever URL you happen to be on and offers no way to edit it, and `/`
 * redirects to your most recent story — so without a manifest every installed
 * copy is pinned forever to whichever story was open the day it was saved.
 * Declaring "/" makes the launcher re-run that redirect on every launch, so the
 * app follows the library instead of one frozen story.
 *
 * `scope` keeps same-origin navigation inside the installed app. Without it iOS
 * infers scope from the saved URL's path, and switching stories can read as
 * leaving the app and bounce you out into Safari.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "draft zero",
    short_name: "draft zero",
    description: "A local-first studio for AI-assisted fiction.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Matches --background in globals.css: white in light, near-black in dark.
    // The manifest takes a single value, so this is the light one; the
    // per-scheme status bar tint is handled by `themeColor` in the root layout.
    background_color: "#ffffff",
    theme_color: "#ffffff",
    orientation: "any",
  }
}
