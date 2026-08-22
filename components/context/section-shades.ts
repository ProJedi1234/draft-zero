import type { ContextSectionId } from "@/lib/generation/types"

/**
 * The bar's one visual channel, and the only place it is defined.
 *
 * Ink at six weights rather than six hues, because this app's palette is
 * deliberately monochrome — hierarchy comes from type and spacing, and a
 * rainbow here would be the loudest thing on any screen it appeared on. A
 * lightness ramp would be the wrong encoding for nominal categories, but these
 * are not nominal: they are the order the model reads them in, so the ramp is
 * carrying real information.
 *
 * It ascends with position, which puts the heaviest weight on the last and
 * usually smallest bands. That is deliberate too — a two-pixel sliver of
 * author's note has to survive being two pixels.
 *
 * Written out as whole class strings, never interpolated: Tailwind only ships
 * the classes it can see.
 */
export const SECTION_SHADES: Record<ContextSectionId, string> = {
  system: "bg-foreground/30",
  memory: "bg-foreground/45",
  lore: "bg-foreground/55",
  summary: "bg-foreground/70",
  story: "bg-foreground/82",
  authorsNote: "bg-foreground/95",
}
