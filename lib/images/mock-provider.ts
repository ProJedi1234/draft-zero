// lib/images/mock-provider.ts — Deterministic, offline ImageGenerationProvider.
// Runs identically in the browser and on the server: seeded arithmetic +
// setTimeout, no I/O, no randomness, no network. Same output for the same seed.
//
// It draws an SVG rather than shipping fixture PNGs for one reason: takes have
// to be visibly different from each other. A pool of stock images would cycle,
// and two retries landing on the same picture would make the variant switcher
// look broken when it was working. A seeded composition is different every
// time and identical on every replay, which is what the mock's contract asks
// for.

import { aspectRatioValue, type ImageAspectRatio } from "@/lib/types"

import type {
  ImageGenerationEvent,
  ImageGenerationProvider,
  ImageGenerationRequest,
} from "./types"

export const MOCK_IMAGE_MEDIA_TYPE = "image/svg+xml"

export interface MockImageProviderOptions {
  /** Delay before the first partial — exercises the "pending" shimmer. Default 500. */
  initialDelayMs?: number
  /** Delay between partials. Default 320. */
  partialDelayMs?: number
  /** How many progressively-sharper previews precede the final image. Default 4. */
  partialCount?: number
}

const DEFAULT_INITIAL_DELAY_MS = 500
const DEFAULT_PARTIAL_DELAY_MS = 320
const DEFAULT_PARTIAL_COUNT = 4

/**
 * The five palettes, as [sky hue, light hue] pairs.
 *
 * Both halves are pinned rather than computed as an offset from the sky. An
 * offset drifts: a warm sky plus a positive offset lands the light source in
 * yellow-green, which is the one hue a dusk glow must never be. Pairing them by
 * hand also lets every palette be the same idea — a warm light against a cooler
 * sky, which is what dusk actually looks like — instead of five different ones.
 */
const PALETTES = [
  [205, 30], // deep blue sky, amber sun
  [260, 330], // violet sky, rose sun
  [335, 25], // rose sky, amber sun
  [25, 350], // amber sky, rose sun
  [175, 40], // teal sky, gold sun
] as const

/** Long edge of the rendered SVG viewBox. Vector — this is proportion, not resolution. */
const LONG_EDGE = 1024

/** FNV-1a, 32-bit. Any stable string→int would do; this one is four lines. */
function hashString(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash | 0
}

/** Resolves after `ms`, or immediately once `signal` aborts. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/**
 * mulberry32 — a small, fast, well-distributed PRNG with an explicit state.
 *
 * `Math.random()` would defeat the whole point: the mock's contract is that a
 * seed reproduces a run exactly, so that a persisted illustration re-renders as
 * the picture the writer accepted rather than as a new one.
 */
function seededRandom(seed: number): () => number {
  let state = (seed | 0) + 0x6d2b79f5
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Base64 of a UTF-8 string, in both runtimes.
 *
 * `btoa` is byte-oriented and throws on anything above U+00FF, so the SVG below
 * is deliberately ASCII-only — no smart quotes, no dashes that aren't hyphens.
 */
function toBase64(text: string): string {
  if (typeof btoa === "function") return btoa(text)
  return Buffer.from(text, "utf8").toString("base64")
}

/** The SVG viewBox for a ratio, long edge fixed so every frame has similar area. */
function frameFor(ratio: ImageAspectRatio): { width: number; height: number } {
  const value = aspectRatioValue(ratio)
  return value >= 1
    ? { width: LONG_EDGE, height: Math.round(LONG_EDGE / value) }
    : { width: Math.round(LONG_EDGE * value), height: LONG_EDGE }
}

/**
 * A seeded abstract composition: sky wash, horizon, a light source, drifting
 * masses, vignette.
 *
 * `blur` is what makes a partial a partial — the same composition rendered
 * soft, sharpening toward zero on the final frame, which is the shape of what
 * a real partial_image stream looks like.
 */
function renderSvg(
  seed: number,
  ratio: ImageAspectRatio,
  blur: number
): string {
  const random = seededRandom(seed)
  const { width, height } = frameFor(ratio)

  // Palette from the curated list, jittered only slightly. A uniform draw over
  // the whole wheel lands in the yellow-green 70-150 arc a fifth of the time,
  // and a dusk sky rendered in it looks ill rather than atmospheric — a problem
  // for a fixture whose whole job is to be looked PAST while the layout is
  // judged. Five palettes is still five visibly different pictures per story.
  const palette = PALETTES[Math.floor(random() * PALETTES.length)]
  const hue = (palette[0] + Math.floor(random() * 24) - 12 + 360) % 360
  const accent = (palette[1] + Math.floor(random() * 16) - 8 + 360) % 360
  const horizon = 0.5 + random() * 0.2
  const horizonY = horizon * height

  const sunX = (0.2 + random() * 0.6) * width
  const sunY = horizonY - random() * height * 0.2
  const sunR = (0.03 + random() * 0.04) * Math.min(width, height)

  // Silhouetted ridges receding toward the horizon: three bands, each lighter
  // and lower-contrast than the one in front of it. Depth is what separates a
  // composition from a pile of shapes, and haze-with-distance is the cheapest
  // honest way to state it.
  const ridges = Array.from({ length: 3 }, (_, layer) => {
    const depth = (3 - layer) / 3
    const base = horizonY + layer * height * 0.09
    const points: string[] = [`0,${height.toFixed(0)}`]
    const steps = 6 + Math.floor(random() * 4)
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * width
      const lift = (0.04 + random() * 0.12) * height * depth
      points.push(`${x.toFixed(0)},${(base - lift).toFixed(0)}`)
    }
    points.push(`${width.toFixed(0)},${height.toFixed(0)}`)
    return `<polygon points="${points.join(" ")}" fill="hsl(${hue} 28% ${(9 + layer * 5).toFixed(0)}%)" opacity="${(0.95 - layer * 0.18).toFixed(2)}"/>`
  })
    // Farthest first, so the nearest ridge paints last and occludes correctly.
    .reverse()
    .join("")

  // A couple of drifting masses well above the ridges — cloud, smoke, weather.
  const masses = Array.from({ length: 2 + Math.floor(random() * 2) }, () => {
    const cx = random() * width
    const cy = random() * horizonY * 0.75
    const r = (0.12 + random() * 0.2) * Math.min(width, height)
    return `<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${r.toFixed(0)}" ry="${(r * 0.42).toFixed(0)}" fill="hsl(${accent} 30% 62%)" opacity="${(0.05 + random() * 0.07).toFixed(2)}"/>`
  }).join("")

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="hsl(${hue} 34% 16%)"/>
<!-- The sky's own hue, not a drifted one: an offset here rotated the warm
     palettes into olive, which is the exact failure the pinned pairs above
     exist to avoid. Only lightness changes down the wash. -->
<stop offset="${((horizon - 0.14) * 100).toFixed(0)}%" stop-color="hsl(${hue} 30% 34%)"/>
<stop offset="${(horizon * 100).toFixed(0)}%" stop-color="hsl(${accent} 38% 62%)"/>
<stop offset="100%" stop-color="hsl(${hue} 30% 12%)"/>
</linearGradient>
<radialGradient id="glow" cx="50%" cy="50%" r="50%">
<stop offset="0%" stop-color="hsl(${accent} 62% 84%)" stop-opacity="0.85"/>
<stop offset="100%" stop-color="hsl(${accent} 62% 72%)" stop-opacity="0"/>
</radialGradient>
<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="hsl(${accent} 40% 72%)" stop-opacity="0"/>
<stop offset="100%" stop-color="hsl(${accent} 40% 72%)" stop-opacity="0.4"/>
</linearGradient>
<radialGradient id="vignette" cx="50%" cy="50%" r="72%">
<stop offset="55%" stop-color="#000" stop-opacity="0"/>
<stop offset="100%" stop-color="#000" stop-opacity="0.45"/>
</radialGradient>
<filter id="soften" x="-20%" y="-20%" width="140%" height="140%">
<feGaussianBlur stdDeviation="${blur.toFixed(1)}"/>
</filter>
<!-- Cloud edges stay soft even on the FINAL frame, where soften is a no-op.
     Without it the drifting masses land as hard discs pasted on the sky. -->
<filter id="drift" x="-30%" y="-30%" width="160%" height="160%">
<feGaussianBlur stdDeviation="${(Math.min(width, height) * 0.05).toFixed(1)}"/>
</filter>
</defs>
<g filter="url(#soften)">
<rect width="${width}" height="${height}" fill="url(#sky)"/>
<g filter="url(#drift)">${masses}</g>
<circle cx="${sunX.toFixed(0)}" cy="${sunY.toFixed(0)}" r="${(sunR * 5).toFixed(0)}" fill="url(#glow)"/>
<circle cx="${sunX.toFixed(0)}" cy="${sunY.toFixed(0)}" r="${sunR.toFixed(0)}" fill="hsl(${accent} 70% 90%)"/>
<rect y="${(horizonY - height * 0.16).toFixed(0)}" width="${width}" height="${(height * 0.16).toFixed(0)}" fill="url(#haze)"/>
${ridges}
</g>
<rect width="${width}" height="${height}" fill="url(#vignette)"/>
</svg>`
}

export class MockImageProvider implements ImageGenerationProvider {
  private readonly initialDelayMs: number
  private readonly partialDelayMs: number
  private readonly partialCount: number

  constructor(options: MockImageProviderOptions = {}) {
    this.initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
    this.partialDelayMs = options.partialDelayMs ?? DEFAULT_PARTIAL_DELAY_MS
    this.partialCount = options.partialCount ?? DEFAULT_PARTIAL_COUNT
  }

  /**
   * The composition is a pure function of `seed`, `modelId` and `aspectRatio`.
   * The prompt is deliberately NOT an input: pretending the words steered the
   * picture is the one lie that would make the offline path useless for judging
   * whether prompt editing works, because every edit would appear to do
   * something.
   */
  async *generate(
    request: ImageGenerationRequest
  ): AsyncGenerator<ImageGenerationEvent> {
    const { aspectRatio, signal } = request
    // The model folded into the seed, so switching models in the inspector
    // visibly redraws. It is a hash of the id and nothing more: this provider
    // has no idea what FLUX looks like, and pretending otherwise is exactly the
    // lie the offline path must not tell.
    const seed = request.seed ^ hashString(request.modelId ?? "")

    await delay(this.initialDelayMs, signal)

    for (let i = 0; i < this.partialCount; i++) {
      if (signal?.aborted) return
      // Halving each pass, so the sharpening is fast at first and slows down —
      // the same curve a real diffusion preview follows.
      const blur = 28 / Math.pow(1.9, i)
      yield {
        type: "partial",
        index: i,
        b64: toBase64(renderSvg(seed, aspectRatio, blur)),
        mediaType: MOCK_IMAGE_MEDIA_TYPE,
      }
      await delay(this.partialDelayMs, signal)
    }

    // Never emitted on an aborted run. OpenRouter bills images all-or-nothing:
    // a generation that did not complete produced no image and cost nothing, so
    // there is nothing to hand back and nothing to record.
    if (signal?.aborted) return
    yield {
      type: "completed",
      b64: toBase64(renderSvg(seed, aspectRatio, 0)),
      mediaType: MOCK_IMAGE_MEDIA_TYPE,
      // Null, not a plausible 0.04: see ImageUsage. Nothing was billed here.
      usage: { costUsd: null, promptTokens: null, completionTokens: null },
    }
  }
}
