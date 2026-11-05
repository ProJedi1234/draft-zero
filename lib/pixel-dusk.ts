// lib/pixel-dusk.ts — A pixel landscape for a wait worth watching.
//
// PARKED, and deliberately wired to nothing. It was built for the story cold
// load and pulled back off it: payloads persist to IndexedDB, so that wait is
// usually zero and the scene either never appeared or flashed. Its home is the
// waits that are genuinely long and have the screen to themselves — scenario
// and template generation, where the reader is waiting on a model rather than
// on a cache. Deleting it and rebuilding it then would cost more than the two
// files cost here.
//
// A pixel scene painted in the story's own tint: hue colours the whole world,
// strength scales every chroma, so an untinted story gets a greyscale dawn
// rather than borrowed colour. Day or night comes from the reader's scheme.
//
// Two invariants carry the whole illusion:
//
// - One clock. Time is absolute (performance.now), never per-instance, so a
//   second canvas mounted mid-animation renders the same frame as the first.
// - Deterministic worlds. Stars, clouds and the dissolve order come from a
//   PRNG seeded by the grid dimensions, so two same-sized canvases agree on
//   where everything is. Together these make the loader→workspace handoff
//   invisible: the dissolve overlay is a different canvas showing the same sky.
//
// The scene redraws at ~11fps on purpose — that is the pixel-art frame feel,
// and most of the battery story on a screen that can sit for many seconds.

export interface DuskConfig {
  hue: number
  strength: number
  day: boolean
}

export interface DuskScene {
  set(next: Partial<DuskConfig>): void
  resize(): void
  dissolve(onDone: () => void): void
  destroy(): void
}

const FRAME_MS = 90
const SKY_BANDS = 7
/** rAF frames for the dissolve — ~0.6s at 60Hz. */
const DISSOLVE_STEPS = 34
const SHOOT_CYCLE_S = 9
const SHOOT_LIFE_S = 0.8

// 2×2 ordered dither: the halo, sky bands and clouds all soften through it.
const BAYER = [
  [0, 2],
  [3, 1],
]

function okl(l: number, c: number, h: number): string {
  return `oklch(${l} ${c} ${h})`
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Star {
  x: number
  y: number
  ph: number
  sp: number
}

interface Cloud {
  /** [x offset, y offset, is bottom row] — bottom rows take the shaded colour. */
  cells: [number, number, boolean][]
  w: number
  x0: number
  y: number
  sp: number
}

interface Spark {
  ang: number
  d: number
  ph: number
  sp: number
}

interface Palette {
  sky: string[]
  /** Back (tallest, lightest) to front (lowest, darkest). */
  hills: [string, string, string]
  disc: string
  crater: string
  halo: string
  star: string
  cloud: string
  cloudShade: string
}

export function createDuskScene(
  canvas: HTMLCanvasElement,
  initial: DuskConfig,
  opts: { animate: boolean }
): DuskScene {
  const ctx = canvas.getContext("2d")
  let cfg = clampConfig(initial)
  let pal = buildPalette(cfg)

  let cell = 6
  let cols = 0
  let rows = 0
  let stars: Star[] = []
  let clouds: Cloud[] = []
  let sparks: Spark[] = []
  let dissolveOrder: number[] = []

  let alive = true
  let dissolving = false
  let lastFrame = 0

  function clampConfig(next: DuskConfig): DuskConfig {
    // Last point before the values stop being data: a NaN here paints nothing
    // and looks like a dead canvas, not like a wrong colour.
    const hue = Number.isFinite(next.hue) ? ((next.hue % 360) + 360) % 360 : 0
    const strength = Number.isFinite(next.strength)
      ? Math.min(1, Math.max(0, next.strength))
      : 0
    return { hue, strength, day: next.day }
  }

  function buildPalette({ hue, strength: s, day }: DuskConfig): Palette {
    const sky: string[] = []
    for (let b = 0; b < SKY_BANDS; b++) {
      const f = b / (SKY_BANDS - 1)
      sky.push(
        day
          ? okl(0.66 + f * 0.21, (0.1 - f * 0.055) * s, hue)
          : okl(0.16 + f * 0.17, (0.02 + f * 0.07) * s, hue)
      )
    }
    return {
      sky,
      hills: day
        ? [
            okl(0.62, 0.075 * s, hue),
            okl(0.5, 0.085 * s, hue),
            okl(0.38, 0.09 * s, hue),
          ]
        : [
            okl(0.3, 0.055 * s, hue),
            okl(0.225, 0.05 * s, hue),
            okl(0.16, 0.04 * s, hue),
          ],
      disc: day ? okl(0.97, 0.03 * s, hue) : okl(0.92, 0.02 * s, hue),
      crater: okl(0.84, 0.03 * s, hue),
      halo: day ? okl(0.88, 0.09 * s, hue) : okl(0.5, 0.08 * s, hue),
      star: okl(0.92, 0.02 * s, hue),
      cloud: okl(0.94, 0.015 * s, hue),
      cloudShade: okl(0.88, 0.03 * s, hue),
    }
  }

  function makeCloud(rng: () => number): Cloud {
    // Tall enough to read as a bank: at two rows the dither skip left only
    // dashes, which read as static on the sky rather than weather.
    const w = 10 + ((rng() * 12) | 0)
    const h = 3 + ((rng() * 2) | 0)
    const cells: [number, number, boolean][] = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x - w / 2) / (w / 2)
        const dy = (y - h / 2) / (h / 2)
        if (dx * dx + dy * dy + rng() * 0.35 < 1)
          cells.push([x, y, y === h - 1])
      }
    }
    return {
      cells,
      w,
      x0: rng() * cols,
      y: 2 + rng() * rows * 0.22,
      sp: 0.25 + rng() * 0.35,
    }
  }

  function regrid(): boolean {
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0 || ctx === null) return false
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Cell size follows the viewport so the scene keeps a roughly constant
    // cell count: neither confetti on a desktop window nor four blocks on a
    // phone held sideways.
    cell = Math.max(
      5,
      Math.min(10, Math.round(Math.min(rect.width, rect.height) / 85))
    )
    cols = Math.ceil(rect.width / cell)
    rows = Math.ceil(rect.height / cell)

    // Seeded by the grid, not by Math.random: same box, same world.
    const rng = mulberry32((cols * 73856093) ^ (rows * 19349663))
    const area = cols * rows

    stars = []
    for (let i = 0; i < area * 0.011; i++) {
      stars.push({
        x: (rng() * cols) | 0,
        y: (rng() * rows * 0.55) | 0,
        ph: rng() * 6.28,
        sp: 0.6 + rng() * 1.6,
      })
    }
    clouds = []
    for (let i = 0; i < Math.max(2, Math.round(cols / 24)); i++)
      clouds.push(makeCloud(rng))
    sparks = []
    for (let i = 0; i < 7; i++) {
      sparks.push({
        ang: rng() * 6.28,
        d: 1.8 + rng() * 3.2,
        ph: rng() * 6.28,
        sp: 1.2 + rng() * 2,
      })
    }
    dissolveOrder = [...Array(area).keys()]
    for (let i = dissolveOrder.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0
      ;[dissolveOrder[i], dissolveOrder[j]] = [
        dissolveOrder[j],
        dissolveOrder[i],
      ]
    }
    return true
  }

  function draw(t: number): void {
    if (ctx === null || cols === 0) return
    const { day } = cfg
    const disc = day
      ? { x: cols * 0.72, y: rows * 0.3, r: Math.min(cols, rows) * 0.1 }
      : { x: cols * 0.74, y: rows * 0.2, r: Math.min(cols, rows) * 0.07 }
    const breathe = 1.1 + 0.9 * (0.5 + 0.5 * Math.sin(t * 1.5))

    // Three layers at 1x/2x/4x — the parallax is what makes it a place and not
    // a static hatch. Heights are fractions of the grid, so portrait and
    // landscape both put the horizon where it belongs.
    const layers = [
      { base: 0.3, amp: 0.055, f1: 0.09, f2: 0.23, sp: 0.055 },
      { base: 0.22, amp: 0.045, f1: 0.13, f2: 0.31, sp: 0.11 },
      { base: 0.14, amp: 0.035, f1: 0.17, f2: 0.43, sp: 0.22 },
    ].map((H) => {
      const heights = new Array<number>(cols)
      for (let x = 0; x < cols; x++) {
        heights[x] =
          rows *
          (H.base +
            H.amp *
              (Math.sin(x * H.f1 + t * H.sp) +
                0.5 * Math.sin(x * H.f2 - t * H.sp * 1.7)))
      }
      return heights
    })

    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        let col: string
        const fromBottom = rows - y
        if (fromBottom <= layers[2][x]) col = pal.hills[2]
        else if (fromBottom <= layers[1][x]) col = pal.hills[1]
        else if (fromBottom <= layers[0][x]) col = pal.hills[0]
        else {
          const dx = x - disc.x
          const dy = y - disc.y
          const d = Math.hypot(dx, dy)
          if (d < disc.r) {
            // The crater shadow is what keeps the night disc a moon and not a
            // dot; the day disc stays clean.
            col =
              !day &&
              (dx - disc.r * 0.3) ** 2 + (dy + disc.r * 0.25) ** 2 <
                (disc.r * 0.35) ** 2
                ? pal.crater
                : pal.disc
          } else if (d < disc.r + breathe && BAYER[x & 1][y & 1] < 2)
            col = pal.halo
          else {
            const band =
              (y / rows) * (SKY_BANDS - 1) + BAYER[x & 1][y & 1] * 0.22
            col = pal.sky[Math.min(SKY_BANDS - 1, band | 0)]
          }
        }
        ctx.fillStyle = col
        ctx.fillRect(x * cell, y * cell, cell, cell)
      }
    }

    if (!day) {
      for (const s of stars) {
        if (rows - s.y <= layers[0][s.x]) continue
        ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t * s.sp + s.ph))
        ctx.fillStyle = pal.star
        ctx.fillRect(s.x * cell, s.y * cell, cell, cell)
      }
      ctx.globalAlpha = 1

      // Scheduled from absolute time, not per-instance state, for the same
      // reason as everything else: a streak in flight survives the handoff.
      const cycle = Math.floor(t / SHOOT_CYCLE_S)
      const age = t - cycle * SHOOT_CYCLE_S
      if (age < SHOOT_LIFE_S) {
        const rng = mulberry32((cycle * 2654435761) >>> 0)
        const x0 = cols * (0.15 + 0.6 * rng())
        const y0 = rows * (0.05 + 0.15 * rng())
        ctx.fillStyle = pal.star
        for (let k = 0; k < 3; k++) {
          ctx.globalAlpha = (1 - age / SHOOT_LIFE_S) * (1 - k * 0.3)
          ctx.fillRect(
            ((x0 + age * 22 - k) | 0) * cell,
            ((y0 + age * 9 - k * 0.4) | 0) * cell,
            cell,
            cell
          )
        }
        ctx.globalAlpha = 1
      }
    } else {
      for (const sp of sparks) {
        const tw = Math.sin(t * sp.sp + sp.ph)
        if (tw < 0.45) continue
        ctx.globalAlpha = (tw - 0.45) / 0.55
        ctx.fillStyle = pal.disc
        ctx.fillRect(
          ((disc.x + Math.cos(sp.ang) * (disc.r + sp.d)) | 0) * cell,
          ((disc.y + Math.sin(sp.ang) * (disc.r + sp.d)) | 0) * cell,
          cell,
          cell
        )
      }
      ctx.globalAlpha = 1
      for (const c of clouds) {
        const cx = ((c.x0 + t * c.sp) % (cols + c.w)) - c.w
        for (const [ox, oy, shaded] of c.cells) {
          const px = (cx + ox) | 0
          if (px < 0 || px >= cols) continue
          if (BAYER[px & 1][((c.y + oy) | 0) & 1] === 3) continue
          ctx.fillStyle = shaded ? pal.cloudShade : pal.cloud
          ctx.fillRect(px * cell, ((c.y + oy) | 0) * cell, cell, cell)
        }
      }
    }
  }

  function loop(now: number): void {
    if (!alive || dissolving) return
    requestAnimationFrame(loop)
    if (now - lastFrame < FRAME_MS || document.hidden) return
    lastFrame = now
    draw(now / 1000)
  }

  if (regrid()) draw(performance.now() / 1000)
  if (opts.animate) requestAnimationFrame(loop)

  return {
    set(next) {
      cfg = clampConfig({ ...cfg, ...next })
      pal = buildPalette(cfg)
      // The loop repaints on its own; a still scene has to be repainted here.
      if (!opts.animate && !dissolving) draw(performance.now() / 1000)
    },
    resize() {
      // The clock deliberately does not reset: rotation re-grids the world but
      // the hills keep their phase.
      if (regrid() && !dissolving) draw(performance.now() / 1000)
    },
    dissolve(onDone) {
      if (dissolving || ctx === null) return
      dissolving = true
      if (!opts.animate) {
        // Reduced motion: the CSS crossfade above this canvas is the whole
        // transition, so the scene just gets out of the way.
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        onDone()
        return
      }
      const total = dissolveOrder.length
      let cleared = 0
      let step = 0
      const clearChunk = (): void => {
        if (!alive) return
        step++
        const upto = Math.round(total * (step / DISSOLVE_STEPS))
        for (; cleared < upto; cleared++) {
          const idx = dissolveOrder[cleared]
          ctx.clearRect(
            (idx % cols) * cell,
            ((idx / cols) | 0) * cell,
            cell,
            cell
          )
        }
        if (step < DISSOLVE_STEPS) requestAnimationFrame(clearChunk)
        else onDone()
      }
      requestAnimationFrame(clearChunk)
    },
    destroy() {
      alive = false
    },
  }
}
