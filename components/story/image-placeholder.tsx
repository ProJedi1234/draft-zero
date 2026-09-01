/**
 * What fills the figure while an illustration is being drawn.
 *
 * A survey being plotted: fine rules drifting upward at two speeds, under a
 * band travelling down with a bright leading edge. Chosen over a shimmer, a
 * pixel grid and four others because it is the only one that reads as *work
 * happening* without competing with the prose it sits under.
 *
 * The design constraint, which every value here is set by: this is on screen
 * for 20-40 seconds (a Seedream render took 31), directly below a paragraph
 * someone is reading. So it is slow, it is faint, nothing pulses, and nothing
 * has a hard edge except the single scan rule that gives it its name.
 *
 * Server component: it is three divs and no state.
 */
export function ImagePlaceholder() {
  return (
    // aria-hidden, and the figure carries the real announcement: a screen
    // reader has nothing to gain from three decorative layers, and the canvas
    // already says a generation is running.
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      {/* Far layer: wider spacing, half speed. Motion-safe on both, so a
          reduced-motion reader gets a static topographic hatch — still a
          legible "something is coming" mark, just not a moving one. */}
      <div
        className="absolute inset-0 motion-safe:animate-contour-far"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to bottom, var(--color-foreground) 0 1px, transparent 1px 14px)",
          opacity: 0.05,
        }}
      />
      {/* Near layer: tighter, faster. The two spacings are deliberately not
          multiples of each other — 9 and 14 — so they beat against each other
          slowly instead of locking into one visible grid. */}
      <div
        className="absolute inset-0 motion-safe:animate-contour-near"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to bottom, var(--color-foreground) 0 1px, transparent 1px 9px)",
          opacity: 0.07,
        }}
      />
      {/* The scan: a soft body with one bright rule at its leading edge. The
          rule is the whole effect — a band without it is a gradient sliding
          over stripes, which is what the shimmer already was. */}
      <div className="absolute inset-x-0 top-0 h-1/3 motion-safe:animate-contour-scan">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to bottom, transparent, color-mix(in srgb, var(--color-foreground) 8%, transparent))",
          }}
        />
        <div
          className="absolute inset-x-0 bottom-0 h-px"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-foreground) 22%, transparent)",
          }}
        />
      </div>
    </div>
  )
}
