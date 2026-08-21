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

/**
 * A USD figure, in the register the rest of the app prints numbers in: bare,
 * unrounded where rounding would lie, never a locale currency format and never
 * cents.
 *
 * Accepts a string because that is how Postgres `numeric` arrives, and parsing
 * here is the last possible moment — everything upstream of this call keeps the
 * value decimal.
 *
 * The bands exist because a single precision is wrong at both ends of four
 * orders of magnitude. "$0.00" for a real call is a lie by rounding; "$12.4021"
 * for a month of writing is noise. So: enough digits to prove a small number is
 * not zero, and no more digits than a large number can support.
 *
 *   null / NaN -> "—"    (unknown, and never to be shown as $0.00)
 *   0          -> "$0"
 *   0.00004    -> "<$0.0001"
 *   0.0031     -> "$0.0031"
 *   0.042      -> "$0.042"
 *   12.4       -> "$12.40"
 *   1204.4     -> "$1,204"
 *
 * The "+" that marks a total containing unpriced calls is appended by the
 * caller, which is the only place that knows the count.
 */
export function formatUsd(usd: string | number | null): string {
  if (usd === null) return "—"
  const value = typeof usd === "string" ? Number.parseFloat(usd) : usd
  if (!Number.isFinite(value)) return "—"

  const magnitude = Math.abs(value)
  const sign = value < 0 ? "-" : ""
  if (magnitude === 0) return "$0"
  if (magnitude < 0.0001) return `${sign}<$0.0001`
  if (magnitude < 0.01) return `${sign}$${magnitude.toFixed(4)}`
  if (magnitude < 1) return `${sign}$${magnitude.toFixed(3)}`
  if (magnitude < 100) return `${sign}$${magnitude.toFixed(2)}`
  return `${sign}$${Math.round(magnitude).toLocaleString("en-US")}`
}

/**
 * A total that is knowably incomplete, marked as the floor it is: "$0.42+".
 *
 * `unpriced` is the count of settled calls in the SAME window as `usd` that
 * OpenRouter never priced. Every cost surface needs this and each one wrote it
 * out again, so it lives here — the rule that a total containing unmeasured
 * calls is never presented as exact is the feature's whole honesty story, and
 * it should have exactly one implementation.
 *
 * An unknown total ("—") takes no "+": there is no figure for the marker to
 * qualify, and "—+" is not a thing.
 */
export function formatUsdFloor(
  usd: string | number | null,
  unpriced: number
): string {
  const formatted = formatUsd(usd)
  return unpriced > 0 && formatted !== "—" ? `${formatted}+` : formatted
}

/**
 * "anthropic/claude-opus-4.1" -> "claude-opus-4.1".
 *
 * The vendor is not the answer to "which model wrote this", and none of the
 * places this is used has room for it.
 */
export function shortModelId(modelId: string): string {
  const slash = modelId.lastIndexOf("/")
  return slash === -1 ? modelId : modelId.slice(slash + 1)
}

/**
 * A token count at a glance: 812 -> "812"; 1240 -> "1.2k"; 18_400 -> "18.4k";
 * 1_200_000 -> "1.2M"; null -> "—".
 *
 * Distinct from formatContextLength, which rounds to whole thousands with an
 * uppercase K for catalog entries. These are counts of tokens actually spent,
 * where the tenth is the interesting digit.
 */
export function formatTokenCount(count: number | null): string {
  if (count === null || !Number.isFinite(count)) return "—"
  const magnitude = Math.abs(count)
  if (magnitude >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (magnitude >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return `${Math.round(count)}`
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

/**
 * How long a run has been going, for a library row: 9s -> "9s"; 74s ->
 * "1m 14s"; 3700s -> "1h 2m". Clamped at zero because a device whose clock
 * runs behind the server's would otherwise count down.
 *
 * Coarser than the manuscript's "thinking 12s" on purpose: that readout sits
 * where the writer is watching one passage, and this one is a glance across a
 * whole library, where the answer is "a while" long before it is a number.
 */
export function formatElapsed(
  startedAtIso: string,
  nowMs = Date.now()
): string {
  const seconds = Math.max(
    0,
    Math.floor((nowMs - Date.parse(startedAtIso)) / 1000)
  )
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60)
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
