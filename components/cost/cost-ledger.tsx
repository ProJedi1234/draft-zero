"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"

import type { ModelShareRow, StoryCostProfile } from "@/lib/types"
import {
  formatTokenCount,
  formatUsd,
  formatUsdFloor,
  shortModelId,
} from "@/lib/format"
import { buttonVariants } from "@/components/ui/button"
import { Meter } from "@/components/ui/meter"
import { MICRO_LABEL } from "@/components/cost/micro-label"
import { RowList } from "@/components/cost/row-list"
import { CostSpark } from "@/components/cost/cost-spark"

/** Model rows shown before the list asks to be expanded. */
const VISIBLE_MODELS = 5

/** Whole-number share, with a floor so a real row never reads as 0%. */
function formatShare(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction <= 0) return "—"
  const percent = fraction * 100
  return percent < 1 ? "<1%" : `${Math.round(percent)}%`
}

function ModelRow({ row, total }: { row: ModelShareRow; total: number }) {
  const cost = Number.parseFloat(row.costUsd)
  const fraction = total > 0 && Number.isFinite(cost) ? cost / total : 0

  return (
    <div className="flex items-center gap-3 px-4 py-1.5">
      <span
        className="max-w-[9rem] flex-none truncate font-mono text-xs text-muted-foreground"
        title={row.modelId}
      >
        {shortModelId(row.modelId)}
      </span>
      {/* The house meter — the one bar shape this app owns. */}
      <Meter value={fraction} className="flex-1" />
      <span className="w-14 flex-none text-right font-mono text-xs text-muted-foreground tabular-nums">
        {formatUsd(row.costUsd)}
      </span>
      <span className="w-9 flex-none text-right font-mono text-xs text-muted-foreground/60 tabular-nums">
        {formatShare(fraction)}
      </span>
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
}: {
  profile: StoryCostProfile
  /** First/last generated passage, ISO — the sparkline caption's range. */
  span?: { firstIso: string; lastIso: string } | null
}) {
  const total = Number.parseFloat(profile.totalUsd)

  return (
    <div className="flex flex-col text-sm">
      <section className="px-4 py-3">
        <h2 className={MICRO_LABEL}>This story</h2>
        <p className="mt-1.5 font-mono text-2xl text-foreground tabular-nums">
          {formatUsdFloor(profile.totalUsd, profile.unpricedCalls)}
        </p>
        <p className="mt-1 font-mono text-xs text-muted-foreground tabular-nums">
          {profile.calls} {profile.calls === 1 ? "generation" : "generations"} ·{" "}
          {formatTokenCount(profile.promptTokens)} in ·{" "}
          {formatTokenCount(profile.completionTokens)} out
        </p>
      </section>

      {profile.perEntry.length > 0 ? (
        <section className="border-t px-4 py-3">
          <CostSpark
            entries={profile.perEntry}
            totalUsd={profile.totalUsd}
            span={span}
          />
        </section>
      ) : null}

      {profile.perModel.length > 0 ? (
        <section className="border-t py-2">
          <h2 className={`${MICRO_LABEL} px-4 pt-1 pb-1.5`}>By model</h2>
          <RowList
            rows={profile.perModel}
            cap={VISIBLE_MODELS}
            triggerClassName="mx-4 mb-1"
            renderRow={(row) => (
              <ModelRow key={row.modelId} row={row} total={total} />
            )}
          />
        </section>
      ) : null}

      <footer className="flex items-center justify-between gap-3 border-t px-4 py-2">
        <p className="font-mono text-[0.625rem] text-muted-foreground/60 tabular-nums">
          {profile.unpricedCalls > 0
            ? `${profile.unpricedCalls} ${
                profile.unpricedCalls === 1 ? "generation" : "generations"
              } not recorded`
            : null}
        </p>
        <Link
          href="/usage"
          className={buttonVariants({ variant: "ghost", size: "xs" })}
        >
          All usage
          {/* A lucide glyph, like every other arrow in the app. The unicode "→"
              this used to carry was the only one in the codebase, and the ghost
              button's uppercase + wide tracking letter-spaced it away from the
              word it belonged to. */}
          <ArrowRight data-icon="inline-end" />
        </Link>
      </footer>
    </div>
  )
}
