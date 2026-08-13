import type { MetadataRoute } from "next"

/**
 * Web app manifest — the thing that makes an installed copy behave like an app
 * rather than a bookmark.
 *
 * `start_url` is here for the platforms that honour it — iOS is not one of
 * them. Its "Add to Home Screen" sheet saves whatever URL you are on, offers no
 * way to edit it, and does not substitute this value. What actually fixes the
 * pinned-to-one-story problem is that `/` renders the library instead of
 * redirecting into a story, so there is finally a URL worth saving; declaring
 * it here means it also resolves 200 rather than 307, which is what a start URL
 * has to do to avoid falling out of standalone at launch.
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
    // The `any` icons are used as drawn, edge to edge. The maskable one is the
    // same art inset into its own background, because a maskable icon is
    // cropped to a platform shape and only the inner 80% circle is guaranteed
    // to survive — at full bleed the scroll's corners fall outside it.
    //
    // iOS takes none of these: it uses app/apple-icon.png, which Next links as
    // rel="apple-touch-icon". The tab favicon is app/icon.png, likewise.
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
