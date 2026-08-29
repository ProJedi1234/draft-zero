// lib/images/styles.ts — Art direction, and the one place it is joined to a
// scene. Pure and isomorphic: the composer's style popover and the send path
// both import this, so what the writer picks and what the provider receives can
// never be two different strings.
//
// Style lives BESIDE the scene rather than inside it. The derivation prompt
// bans art direction outright (see DERIVATION_SYSTEM_PROMPT) so that a style
// the writer chose composes with the description instead of fighting whatever
// "digital art, trending on artstation" the model's own priors would smuggle
// in. That ban is only worth anything if something else states the style, and
// this is that something.

/** One offer in the style popover. `text` is what actually reaches the model. */
export interface ImageStylePreset {
  id: string
  /** What the popover row says. */
  label: string
  /** The clause appended to the scene. Short and concrete on purpose. */
  text: string
}

/**
 * The shipped offers.
 *
 * Short, and each naming a medium plus the one or two properties that medium
 * is chosen FOR — an image model given "oil painting" alone averages every oil
 * painting it has seen, while "visible brushwork, warm varnish" picks one. Kept
 * to eight because this is a popover in a composer, not a style library: the
 * writer who wants something else has Custom, which is the honest answer to a
 * taste we cannot enumerate.
 */
export const IMAGE_STYLE_PRESETS: readonly ImageStylePreset[] = [
  {
    id: "photographic",
    label: "Photographic",
    text: "photographic, natural light, shallow depth of field",
  },
  {
    id: "cinematic",
    label: "Cinematic film still",
    text: "cinematic film still, anamorphic, moody colour grade",
  },
  {
    id: "oil",
    label: "Oil painting",
    text: "oil painting, visible brushwork, warm varnish",
  },
  {
    id: "watercolour",
    label: "Watercolour",
    text: "watercolour, soft washes, paper grain",
  },
  {
    id: "ink",
    label: "Ink sketch",
    text: "ink sketch, loose crosshatching, off-white paper",
  },
  { id: "anime", label: "Anime", text: "anime, clean linework, cel shading" },
  {
    id: "storybook",
    label: "Storybook illustration",
    text: "storybook illustration, flat colour, hand-drawn outlines",
  },
  {
    id: "noir",
    label: "Noir",
    text: "black and white noir, hard key light, deep shadow",
  },
] as const

/**
 * The inverse of composeSentPrompt, as far as one is possible: the scene
 * without its trailing
 * style sentence.
 *
 * Needed because a stored `prompt` is what was SENT, style included, and
 * handing that back to the composer would put the style sentence into a lane
 * whose next send appends the style again — "…, cel shading. Style: anime." The
 * pattern is narrow on purpose: only a final sentence that begins "Style: ",
 * which is a shape composeSentPrompt produced and a writer is unlikely to have
 * typed by accident. Anything else is left alone, because guessing wrong here
 * silently deletes the end of someone's prompt.
 *
 * A custom style with a period inside it ("in the style of H.R. Giger") is
 * therefore unsplittable and comes back embedded in the scene, style null.
 * That is the safe failure: the restore path adopts BOTH halves of this
 * result, so the embedded clause is drawn exactly once rather than getting a
 * second copy appended — compose(split(p)) must equal p either way.
 */
export function splitSentPrompt(prompt: string): {
  scene: string
  style: string | null
} {
  const match = /\s*Style:\s*([^.]*)\.\s*$/.exec(prompt)
  if (match === null) return { scene: prompt.trim(), style: null }
  return {
    scene: prompt.slice(0, match.index).trim(),
    style: match[1].trim() || null,
  }
}

/**
 * The scene plus the style, as one string for the image model.
 *
 * A trailing sentence rather than a comma-appended keyword tail: the models
 * this reaches read a prompt as prose (see the ordering note in
 * derivation-prompt.ts), and a sentence keeps the style where it belongs —
 * after the scene has been described, so it colours the description rather than
 * competing with the subject for the opening clause every encoder weights
 * heaviest.
 *
 * Applies in verbatim mode too. The writer's own words are the scene either
 * way; the style is a property of the send, not of who wrote the scene.
 */
export function composeSentPrompt(scene: string, style: string | null): string {
  const body = scene.trim()
  // Trailing punctuation is stripped so a preset and a hand-typed custom style
  // that differ only by a full stop cannot produce "…, cel shading.."
  const direction = (style ?? "").trim().replace(/[.。]+$/, "")
  if (direction === "") return body
  if (body === "") return `Style: ${direction}.`
  return `${body} Style: ${direction}.`
}
