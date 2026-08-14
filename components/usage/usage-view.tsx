"use client"

import * as React from "react"
import Link from "next/link"

import { SpendBars } from "@/components/usage/spend-bars"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Meter } from "@/components/ui/meter"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { MICRO_LABEL } from "@/components/cost/micro-label"
import { RowList } from "@/components/cost/row-list"
import {
  formatTokenCount,
  formatUsd,
  formatUsdFloor,
  shortModelId,
} from "@/lib/format"
import type { SpendBar } from "@/lib/spend-window"
import type {
  GlobalCostSummary,
  ModelSpendRow,
  StorySpendRow,
} from "@/lib/types"

/** How many rows a list shows before it asks to be expanded. */
const ROW_CAP = 8

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

function UsageView({
  summary,
  bars,
  byStory,
  byModel,
  windowDays = 30,
  windowUsd,
  windowUnpricedCalls,
}: {
  summary: GlobalCostSummary
  /** Zero-filled on the server, off the same clock the SQL bounds came from. */
  bars: SpendBar[]
  byStory: StorySpendRow[]
  byModel: ModelSpendRow[]
  windowDays?: number
  /** Exact window total, summed in SQL rather than from the drawn buckets. */
  windowUsd: string
  windowUnpricedCalls: number
}) {
  // The busiest model sets the scale for every share bar, so it is computed
  // once for the list rather than once per row.
  const modelPeak = React.useMemo(
    () =>
      byModel.reduce(
        (max, m) => Math.max(max, Number.parseFloat(m.costUsd) || 0),
        0
      ),
    [byModel]
  )

  return (
    <div className="flex h-app flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger />
        <h1 className="text-sm font-medium">Usage</h1>
        <div className="flex-1" />
        {/* The one place in the app a cost figure is visible unsummoned. It is
            allowed here because reading it is the reason the page exists. */}
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {formatUsdFloor(summary.todayUsd, summary.todayUnpricedCalls)} today
        </span>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-2xl space-y-6 px-6 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <Card size="sm">
            <CardHeader>
              <CardTitle>Right now</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 divide-x divide-border">
                <Figure
                  label="Today"
                  value={formatUsdFloor(
                    summary.todayUsd,
                    summary.todayUnpricedCalls
                  )}
                />
                <Figure
                  label="This week"
                  value={formatUsdFloor(
                    summary.weekUsd,
                    summary.weekUnpricedCalls
                  )}
                  className="px-4"
                />
                <Figure
                  label="All time"
                  value={formatUsdFloor(
                    summary.allTimeUsd,
                    summary.unpricedCalls
                  )}
                  className="pl-4"
                />
              </div>
              {/* Every window on this page is bucketed on UTC days, so the
                  boundary is stated rather than left to be inferred: west of
                  UTC "today" turns over mid-afternoon, and a figure that
                  silently disagrees with the writer's own sense of today reads
                  as a bug in the ledger. */}
              <p className="font-mono text-[0.6875rem] text-muted-foreground/50">
                Days start at 00:00 UTC.
                {summary.unpricedCalls > 0
                  ? ` ${plural(summary.unpricedCalls, "generation")} not recorded.`
                  : ""}
              </p>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Over time</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Padded top so the hover readout has somewhere to sit. */}
              <div className="pt-6">
                <SpendBars bars={bars} />
              </div>
              <div className="flex items-baseline justify-between">
                <span className={MICRO_LABEL}>Last {windowDays} days</span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {formatUsdFloor(windowUsd, windowUnpricedCalls)}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>By story</CardTitle>
            </CardHeader>
            <CardContent>
              <RowList
                rows={byStory}
                cap={ROW_CAP}
                empty="Nothing generated yet."
                className="-mx-2"
                triggerClassName="mx-2"
                renderRow={(row) => (
                  <StoryRow key={row.storyId ?? row.title} row={row} />
                )}
              />
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>By model</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <RowList
                  rows={byModel}
                  cap={ROW_CAP}
                  empty="Nothing generated yet."
                  className="-mx-2"
                  triggerClassName="mx-2"
                  renderRow={(row) => (
                    <ModelRow key={row.modelId} row={row} peak={modelPeak} />
                  )}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  )
}

function Figure({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={className}>
      <p className={MICRO_LABEL}>{label}</p>
      <p className="mt-1 font-mono text-2xl tabular-nums">{value}</p>
    </div>
  )
}

const ROW =
  "flex items-baseline gap-3 px-2 py-1.5 transition-colors hover:bg-muted/40"

function StoryRow({ row }: { row: StorySpendRow }) {
  const title = (
    <span
      className={
        row.isDeleted
          ? "truncate font-serif text-sm text-muted-foreground/50"
          : "truncate font-serif text-sm"
      }
    >
      {row.title}
    </span>
  )

  const body = (
    <>
      {title}
      <span className="flex-1" />
      <span className="shrink-0 font-mono text-xs text-muted-foreground/50 tabular-nums">
        {row.calls}
      </span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
        {formatUsd(row.costUsd)}
      </span>
    </>
  )

  // A deleted story keeps its line — the money left the account regardless —
  // but there is nowhere to send the click.
  if (row.isDeleted || row.storyId === null) {
    return <div className={ROW}>{body}</div>
  }

  return (
    <Link href={`/story/${row.storyId}`} className={ROW}>
      {body}
    </Link>
  )
}

function ModelRow({ row, peak }: { row: ModelSpendRow; peak: number }) {
  const value = Number.parseFloat(row.costUsd) || 0

  return (
    <div className="px-2 py-1.5 transition-colors hover:bg-muted/40">
      <div className="flex items-baseline gap-3">
        <span className="truncate font-mono text-xs">
          {shortModelId(row.modelId)}
        </span>
        <span className="flex-1" />
        <span className="shrink-0 font-mono text-xs text-muted-foreground/50 tabular-nums">
          {row.calls}
        </span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground/50 tabular-nums">
          {formatTokenCount(row.promptTokens)}/
          {formatTokenCount(row.completionTokens)}
        </span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {formatUsd(row.costUsd)}
        </span>
      </div>
      {/* Share as a bar, not a pie: one dimension, monochrome, no legend —
          the house meter, same as the ledger's. */}
      <Meter value={peak > 0 ? value / peak : 0} className="mt-1.5" />
    </div>
  )
}

export { UsageView }
