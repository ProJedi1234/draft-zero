"use client"

import { Loader2 } from "lucide-react"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ContextBreakdown } from "@/lib/generation/breakdown"

import { ContextBreakdownView } from "./context-breakdown-view"

const TITLE = "View context"

/**
 * The viewer, as a dialog. A sheet on a phone, because its body scrolls.
 *
 * Takes a breakdown rather than fetching one: its two callers get theirs from
 * different places — one from disk, one composed on the spot — and the dialog
 * has no business knowing which.
 */
export function ContextDialog({
  open,
  onOpenChange,
  caption,
  meta,
  note,
  breakdown,
  loading = false,
  emptyMessage,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The line above the bar — what this context is. */
  caption: string
  /** Provenance under the title, e.g. the model that wrote the passage. */
  meta?: string
  /** How this context was arrived at, when that changes how to read it. */
  note?: string
  breakdown: ContextBreakdown | null
  loading?: boolean
  /** Shown instead of the bar when there is no breakdown to show, and why. */
  emptyMessage?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent sheet className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{TITLE}</DialogTitle>
          {meta && <DialogDescription>{meta}</DialogDescription>}
        </DialogHeader>
        <DialogBody className="sm:max-h-[60vh]">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading the context…
            </div>
          ) : breakdown ? (
            <div className="space-y-4">
              <ContextBreakdownView breakdown={breakdown} caption={caption} />
              {note && (
                <p className="text-xs leading-5 text-muted-foreground">
                  {note}
                </p>
              )}
            </div>
          ) : (
            <p className="py-8 text-sm text-muted-foreground">
              {emptyMessage ?? "There's nothing to show for this passage."}
            </p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
