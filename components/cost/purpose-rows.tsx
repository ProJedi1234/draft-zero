"use client"

import * as React from "react"
import { ChevronRight } from "lucide-react"

import { formatUsd, formatUsdFloor, shortModelId } from "@/lib/format"
import { SPEND_PURPOSE_LABELS } from "@/lib/spend-purpose"
import type { PurposeSpendRow, SpendFigure, SpendPart } from "@/lib/types"
import { cn } from "@/lib/utils"
import {
  partFill,
  purposeFill,
  SpendSwatch,
} from "@/components/cost/spend-swatch"

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Whole-number share, with a floor so a real row never reads as 0%. */
export function formatShare(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction <= 0) return "—"
  const percent = fraction * 100
  return percent < 1 ? "<1%" : `${Math.round(percent)}%`
}

/** Mean price of the calls that were priced, or null when none were. */
function perCall(figure: SpendFigure): number | null {
  const priced = figure.calls - figure.unpricedCalls
  const cost = Number.parseFloat(figure.costUsd)
  return priced > 0 && Number.isFinite(cost) ? cost / priced : null
}

function usd(figure: SpendFigure): string {
  return formatUsdFloor(figure.costUsd, figure.unpricedCalls)
}

function Line({
  fill,
  off,
  label,
  amount,
}: {
  fill?: string
  off?: boolean
  label: string
  amount?: string
}) {
  return (
    <div className="flex items-center gap-2 py-0.5 pl-[1.125rem] text-[0.6875rem] text-muted-foreground">
      <SpendSwatch fill={fill} off={off} className="size-1.5" />
      <span className={cn("flex-1", off && "text-muted-foreground/60")}>
        {label}
      </span>
      {amount ? <span className="tabular-nums">{amount}</span> : null}
      {/* Holds the share and chevron columns so amounts align with the row's. */}
      <span className="w-14 flex-none" />
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="pt-0.5 pb-1 pl-[1.125rem] text-[0.6875rem] text-muted-foreground">
      {children}
    </p>
  )
}

function partOf(row: PurposeSpendRow, part: SpendPart) {
  return row.parts.find((p) => p.part === part)
}

/** The lines and notes under a purpose's headline, always visible. */
function Detail({
  row,
  memory,
}: {
  row: PurposeSpendRow
  memory: { world: boolean; recap: boolean }
}) {
  switch (row.purpose) {
    case "story": {
      const take = partOf(row, "take")
      const reroll = partOf(row, "reroll")
      if (!reroll) {
        const each = perCall(row)
        return (
          <Note>
            {plural(row.calls, "call")}
            {each !== null ? ` · ${formatUsd(each)} each` : null}
          </Note>
        )
      }
      const takeEach = take ? perCall(take) : null
      const rerollEach = perCall(reroll)
      return (
        <>
          {take ? (
            <Line
              fill={partFill("take")}
              label={`first takes · ${take.calls}`}
              amount={usd(take)}
            />
          ) : null}
          <Line
            fill={partFill("reroll")}
            label={`re-rolls · ${reroll.calls}`}
            amount={usd(reroll)}
          />
          {takeEach !== null && rerollEach !== null && takeEach > 0 ? (
            <Note>
              {formatUsd(rerollEach)} a re-roll,{" "}
              {(rerollEach / takeEach).toFixed(1)}× a first take
            </Note>
          ) : null}
        </>
      )
    }
    case "pictures": {
      const image = partOf(row, "image")
      const prompt = partOf(row, "image-prompt")
      return (
        <Note>
          {[
            image ? plural(image.calls, "image") : null,
            prompt ? plural(prompt.calls, "prompt") : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Note>
      )
    }
    case "memory": {
      const world = partOf(row, "world")
      const recap = partOf(row, "recap")
      return (
        <div className="pb-1">
          {world ? (
            <Line
              fill={partFill("world")}
              label={`world · ${plural(world.calls, "pass", "passes")}`}
              amount={usd(world)}
            />
          ) : !memory.world ? (
            <Line off label="world · off" />
          ) : null}
          {recap ? (
            <Line
              fill={partFill("recap")}
              label={`recap · ${plural(recap.calls, "update")}`}
              amount={usd(recap)}
            />
          ) : !memory.recap ? (
            <Line off label="recap · off" />
          ) : null}
        </div>
      )
    }
    case "atmosphere":
      return <Note>{plural(row.calls, "check")}</Note>
  }
}

function PurposeRow({
  row,
  share,
  memory,
}: {
  row: PurposeSpendRow
  share: string
  memory: { world: boolean; recap: boolean }
}) {
  const [open, setOpen] = React.useState(false)
  const modelsId = React.useId()

  return (
    <div className={cn("-mx-2 rounded-sm px-2", open && "bg-muted/50")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={modelsId}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          "-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-sm px-2 pt-1.5 pb-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
          !open && "hover:bg-muted/50"
        )}
      >
        <SpendSwatch fill={purposeFill(row.purpose)} />
        <span className="flex-1 font-sans text-[0.8125rem] text-foreground">
          {SPEND_PURPOSE_LABELS[row.purpose]}
        </span>
        <span className="font-mono text-xs text-foreground tabular-nums">
          {usd(row)}
        </span>
        <span className="w-9 flex-none text-right font-mono text-xs text-muted-foreground/60 tabular-nums">
          {share}
        </span>
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3 flex-none text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
        />
      </button>
      <div className="font-mono">
        <Detail row={row} memory={memory} />
      </div>
      {open ? (
        <ul
          id={modelsId}
          aria-label={`Models used for ${SPEND_PURPOSE_LABELS[row.purpose].toLowerCase()}`}
          className="mt-0.5 mb-2 ml-[1.125rem] border-l pl-2.5 font-mono text-[0.6875rem]"
        >
          {row.models.map((model) => (
            <li
              key={model.modelId}
              className="flex items-baseline gap-2 py-0.5"
            >
              <span className="flex-1 truncate" title={model.modelId}>
                {shortModelId(model.modelId)}
              </span>
              <span className="tabular-nums">{usd(model)}</span>
              <span className="w-14 flex-none text-right text-muted-foreground/60 tabular-nums">
                {plural(model.calls, "call")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * "Where it went": one row per purpose, each opening in place onto the models
 * that did that job. Closing is the same click, so there is no view to leave.
 */
export function PurposeRows({
  rows,
  totalUsd,
  memory,
}: {
  rows: PurposeSpendRow[]
  totalUsd: string
  /** Which memory features are on, so a switched-off one can say so. */
  memory: { world: boolean; recap: boolean }
}) {
  const total = Number.parseFloat(totalUsd)
  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <PurposeRow
          key={row.purpose}
          row={row}
          memory={memory}
          share={formatShare(
            total > 0 ? Number.parseFloat(row.costUsd) / total : 0
          )}
        />
      ))}
    </div>
  )
}
