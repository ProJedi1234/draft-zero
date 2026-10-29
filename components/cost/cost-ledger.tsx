"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"

import type { PurposeSpendRow, StoryCostProfile } from "@/lib/types"
import { formatTokenCount, formatUsd, formatUsdFloor } from "@/lib/format"
import { SPEND_PART_LABELS, SPEND_PURPOSE_LABELS } from "@/lib/spend-purpose"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import { MICRO_LABEL } from "@/components/cost/micro-label"
import { formatShare, PurposeRows } from "@/components/cost/purpose-rows"
import { partFill, purposeFill } from "@/components/cost/spend-swatch"
import { TurnSpend } from "@/components/cost/turn-spend"

interface Segment {
  key: string
  label: string
  fill: string
  usd: number
}

/** Story and memory split into their lines; pictures and atmosphere stay whole. */
function segmentsOf(rows: PurposeSpendRow[]): Segment[] {
  return rows.flatMap((row) => {
    const split = row.purpose === "story" || row.purpose === "memory"
    const pieces = split
      ? row.parts.map((part) => ({
          key: part.part,
          label: SPEND_PART_LABELS[part.part],
          fill: partFill(part.part),
          usd: Number.parseFloat(part.costUsd),
        }))
      : [
          {
            key: row.purpose,
            label: SPEND_PURPOSE_LABELS[row.purpose],
            fill: purposeFill(row.purpose),
            usd: Number.parseFloat(row.costUsd),
          },
        ]
    return pieces.filter((piece) => Number.isFinite(piece.usd) && piece.usd > 0)
  })
}

function SpendBar({ rows, total }: { rows: PurposeSpendRow[]; total: number }) {
  const segments = segmentsOf(rows)
  if (segments.length === 0 || !(total > 0)) return null
  const label = segments
    .map((s) => `${s.label} ${formatShare(s.usd / total)}`)
    .join(", ")
  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className="mt-3 flex h-2 gap-0.5"
    >
      {segments.map((segment) => (
        <span
          key={segment.key}
          className={cn("h-full min-w-0.5 basis-0 rounded-[1px]", segment.fill)}
          style={{ flexGrow: segment.usd * 1e6 }}
        />
      ))}
    </div>
  )
}

/**
 * Everything the story-level cost surface knows, in one summoned panel.
 *
 * Rendered from server-fetched props, so it opens with the figures already in
 * it: a spend readout that makes the reader wait behind a spinner has failed at
 * the only thing it was for.
 */
export function CostLedger({
  profile,
  span,
  memory,
  onJump,
}: {
  profile: StoryCostProfile
  /** First/last generated passage, ISO — the strip caption's range. */
  span?: { firstIso: string; lastIso: string } | null
  memory: { world: boolean; recap: boolean }
  onJump: (entryId: string) => void
}) {
  const total = Number.parseFloat(profile.totalUsd)
  const turns = profile.perTurn.length

  return (
    <div className="flex flex-col text-sm">
      <section className="px-4 py-3">
        <h2 className={MICRO_LABEL}>This story</h2>
        <p className="mt-1.5 font-mono text-2xl text-foreground tabular-nums">
          {formatUsdFloor(profile.totalUsd, profile.unpricedCalls)}
        </p>
        {turns > 0 && total > 0 ? (
          <p className="mt-1 font-mono text-xs text-muted-foreground tabular-nums">
            {turns} {turns === 1 ? "turn" : "turns"} · ≈{" "}
            {formatUsd(total / turns)} each
          </p>
        ) : null}
        <p className="mt-1 font-mono text-xs text-muted-foreground/70 tabular-nums">
          {profile.calls} {profile.calls === 1 ? "call" : "calls"} ·{" "}
          {formatTokenCount(profile.promptTokens)} in ·{" "}
          {formatTokenCount(profile.completionTokens)} out
        </p>
        {profile.unpricedCalls > 0 ? (
          <p className="mt-1 font-mono text-xs text-muted-foreground/70 tabular-nums">
            {profile.unpricedCalls}{" "}
            {profile.unpricedCalls === 1 ? "call" : "calls"} not recorded
          </p>
        ) : null}
        <SpendBar rows={profile.perPurpose} total={total} />
      </section>

      {profile.perPurpose.length > 0 ? (
        <section className="border-t px-4 py-3">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className={MICRO_LABEL}>Where it went</h2>
            <span className="font-mono text-[0.625rem] text-muted-foreground/60">
              open a row for its models
            </span>
          </div>
          <PurposeRows
            rows={profile.perPurpose}
            totalUsd={profile.totalUsd}
            memory={memory}
          />
        </section>
      ) : null}

      {turns > 0 ? (
        <TurnSpend rows={profile.perTurn} span={span ?? null} onJump={onJump} />
      ) : null}

      <footer className="flex items-center justify-end border-t px-4 py-2">
        <Link
          href="/usage"
          className={buttonVariants({ variant: "ghost", size: "xs" })}
        >
          All usage
          {/* A lucide glyph, like every other arrow in the app. The unicode "→"
              letter-spaced away from its word under the ghost button's tracking. */}
          <ArrowRight data-icon="inline-end" />
        </Link>
      </footer>
    </div>
  )
}
