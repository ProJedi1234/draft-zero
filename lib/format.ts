// lib/format.ts — Deterministic formatting helpers shared by every package.
// All output is SSR-safe: relative dates are computed against a pinned mock
// "now" so server and client render identical strings.

/** Pinned "now" for the static-scaffolding milestone. */
export const MOCK_NOW_ISO = "2026-08-10T12:00:00Z"

const MOCK_NOW_MS = Date.parse(MOCK_NOW_ISO)
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

/** ISO -> "Aug 9, 2026" (UTC, deterministic). */
export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** Day-granularity relative label against MOCK_NOW_ISO: "today", "yesterday", "3d ago", "2w ago", "4mo ago", "1y ago". */
export function formatRelativeDate(iso: string): string {
  const days = Math.floor((MOCK_NOW_MS - Date.parse(iso)) / DAY_MS)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}
