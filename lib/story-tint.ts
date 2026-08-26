// lib/story-tint.ts — The named points in the tint space.
//
// A story's atmosphere is two numbers (see globals.css), which is a space, not
// a list. These are labelled coordinates in it, for the swatch row — the same
// mechanism a hue typed by hand or chosen by a model would use, not a separate
// "preset" path. Nothing here is stored; the story stores the numbers.
//
// Strength varies per hue on purpose. Cool hues read as more present than warm
// ones at equal chroma, so a lagoon at 1.0 shouts where a sun-gold at 1.0 only
// warms; the numbers below are what makes the row feel evenly weighted.

export interface StoryTint {
  /** Stable id — what the swatch row keys and compares on. */
  id: string
  label: string
  /** Degrees. */
  hue: number
  /** 0..1. */
  strength: number
}

export const STORY_TINTS: readonly StoryTint[] = [
  { id: "ember", label: "Ember", hue: 25, strength: 1 },
  { id: "amber", label: "Amber", hue: 60, strength: 1 },
  { id: "sun", label: "Sun-gold", hue: 85, strength: 1 },
  { id: "verdant", label: "Verdant", hue: 150, strength: 0.9 },
  { id: "lagoon", label: "Lagoon", hue: 200, strength: 0.85 },
  { id: "abyss", label: "Abyss", hue: 255, strength: 0.85 },
  { id: "iris", label: "Iris", hue: 300, strength: 0.9 },
  { id: "rose", label: "Rose", hue: 350, strength: 0.95 },
]
