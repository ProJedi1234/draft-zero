// lib/spend-window.ts — Turning the sparse daily-spend rows into a fixed strip.
//
// Deliberately not inside the "use client" chart module. The window's last day
// has to be the SAME day the SQL lower bound was derived from, and that bound
// comes from the server clock and the server-resolved zone (app/usage/page.tsx,
// lib/time-zone.ts). Deciding it from `new Date()` during a client render meant
// the server and the browser could disagree — across a day boundary, or
// whenever a machine's clock is skewed — which showed up as a hydration
// mismatch and a caption whose total no longer described the bars beside it.

import type { SpendDay } from "@/lib/types"

export interface SpendBar extends SpendDay {
  /** Parsed once, here, purely to size the bar — never to add anything up. */
  value: number
}

/**
 * Zero-fills the window the query deliberately leaves sparse (see
 * getSpendByDay). Days are "YYYY-MM-DD" keys, oldest first, so the strip has
 * one slot per day whether or not anything was spent in it.
 *
 * `today` is the window's last day, passed in rather than read from a clock.
 *
 * Stepping in UTC over keys bucketed in another zone is deliberate — they are
 * bare calendar dates by then, and a fixed offset is what stops a DST week
 * producing a duplicate or missing slot.
 */
export function buildSpendWindow(
  days: SpendDay[],
  window: number,
  today: string
): SpendBar[] {
  const bySpend = new Map(days.map((d) => [d.day, d]))
  const end = Date.parse(`${today}T00:00:00Z`)
  const out: SpendBar[] = []

  for (let i = window - 1; i >= 0; i--) {
    const day = new Date(end - i * 86_400_000).toISOString().slice(0, 10)
    const hit = bySpend.get(day)
    out.push({
      day,
      costUsd: hit?.costUsd ?? "0",
      calls: hit?.calls ?? 0,
      value: hit ? Number.parseFloat(hit.costUsd) || 0 : 0,
    })
  }

  return out
}
