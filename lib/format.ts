// lib/format.ts — Deterministic formatting helpers shared by every package.
// All output is SSR-safe: relative dates are computed against a pinned mock
// "now" so server and client render identical strings.

/** Pinned "now" from the static-scaffolding milestone (still used by fixtures). */
export const MOCK_NOW_ISO = "2026-08-10T12:00:00Z"

const DAY_MS = 86_400_000

/** 12480 -> "12,480 words"; 1 -> "1 word". */
export function formatWordCount(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "word" : "words"}`
}

/** 200000 -> "200K"; 1048576 -> "1M"; 131072 -> "131K". */
export function formatContextLength(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return `${tokens}`
}

/**
 * Output speed for a provider row: 41.6 -> "42 tps"; 1240 -> "1.2k tps"; null
 * (OpenRouter has no recent measurement) -> "—". Rounded to whole tokens
 * because the p50 moves by more than a decimal between refreshes anyway.
 */
export function formatThroughput(tokensPerSecond: number | null): string {
  if (tokensPerSecond === null || !Number.isFinite(tokensPerSecond)) return "—"
  if (tokensPerSecond >= 1_000)
    return `${(tokensPerSecond / 1_000).toFixed(1)}k tps`
  return `${Math.round(tokensPerSecond)} tps`
}

/**
 * Uptime fraction as a whole percentage: 0.9987 -> "99%"; null -> "—". Rounded
 * down, not nearest: a provider at 99.6% has had real failures this week and
 * should not be advertised as a flat 100%.
 */
export function formatUptime(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return "—"
  return `${Math.floor(fraction * 100)}%`
}

/** ISO -> "Aug 9, 2026" (UTC, deterministic). */
export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** Day-granularity relative label against `nowMs` (default: now): "today", "yesterday", "3d ago", "2w ago", "4mo ago", "1y ago". */
export function formatRelativeDate(
  iso: string,
  nowMs: number = Date.now()
): string {
  const days = Math.floor((nowMs - Date.parse(iso)) / DAY_MS)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}
