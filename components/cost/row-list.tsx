"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A capped list with one way to ask for the rest of it.
 *
 * Shared by every ranked list in the cost feature — the ledger's models, the
 * usage page's stories and models — because those had grown two different
 * disclosure controls: a Collapsible reading "{n} more" that could only open,
 * and a plain button reading "show all {n}" that toggled. Two gestures for one
 * idea, inside one feature, is a thing the reader has to learn twice.
 */
function RowList<T>({
  rows,
  cap,
  empty,
  className,
  triggerClassName,
  renderRow,
}: {
  rows: T[]
  /** Rows shown before the list asks to be expanded. */
  cap: number
  /** Shown instead of the list when there is nothing in it. */
  empty?: string
  className?: string
  /** Inset for the trigger, which has to line up with the rows above it. */
  triggerClassName?: string
  renderRow: (row: T) => React.ReactNode
}) {
  const [expanded, setExpanded] = React.useState(false)

  if (rows.length === 0) {
    return empty ? (
      <p className="text-xs text-muted-foreground">{empty}</p>
    ) : null
  }

  const visible = expanded ? rows : rows.slice(0, cap)

  return (
    <div className={className}>
      {visible.map(renderRow)}
      {rows.length > cap ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className={cn(
            "mt-2 font-mono text-xs text-muted-foreground/60 lowercase transition-colors hover:text-foreground",
            triggerClassName
          )}
        >
          {expanded ? "show less" : `show all ${rows.length}`}
        </button>
      ) : null}
    </div>
  )
}

export { RowList }
