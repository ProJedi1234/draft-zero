import type * as React from "react"

import type { StorySummary } from "@/lib/types"

/**
 * The two numbers every `.story-card` rule reads, as inline custom properties.
 *
 * A null hue is chroma 0, not hue 0: an untinted story has no colour at all,
 * and hue 0 with the strength left on would paint it red.
 */
export function tintVars(
  story: Pick<StorySummary, "tintHue" | "tintStrength">
): React.CSSProperties {
  return {
    "--story-h": story.tintHue ?? 0,
    "--story-c": story.tintHue === null ? 0 : story.tintStrength,
  } as React.CSSProperties
}
