"use client"

import * as React from "react"
import { Pencil, RefreshCw, Square, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import type { ImageJob } from "@/hooks/use-image-generation"
import {
  deleteIllustration,
  restoreIllustration,
} from "@/lib/actions/images"
import { aspectRatioValue, type StoryImage } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ImageCostChip } from "@/components/cost/image-cost-chip"
import { ImagePlaceholder } from "@/components/story/image-placeholder"
import { ImageVariantSwitcher } from "@/components/story/image-variant-switcher"

/** A data URI for a partial's base64. Partials are never persisted, so they never get a URL. */
function previewSrc(b64: string, mediaType: string): string {
  return `data:${mediaType};base64,${b64}`
}

/**
 * An illustration in the manuscript: a shimmer that becomes a picture.
 *
 * A beat in its own right, sitting in the story's ordering sequence between
 * passages rather than hanging off one — so it is rendered by the canvas
 * alongside StoryEntryBlock, not inside it.
 *
 * The placeholder is reserved at the requested aspect ratio from the first
 * frame, so nothing in the manuscript moves when the pixels land. That is the
 * whole reason the frame is chosen before generation rather than discovered
 * after it: prose that reflows under the reader mid-generation is the one thing
 * a writing app cannot do.
 */
export function ImageBlock({
  storyId,
  image,
  job,
  busy,
  onRetry,
  onEditPrompt,
  onStop,
}: {
  storyId: string
  /** The persisted illustration, or null while the first one is still being drawn. */
  image: StoryImage | null
  /** The generation in flight, or null. Wins over `image`: it is the newer picture. */
  job: ImageJob | null
  busy: boolean
  onRetry: () => void
  /**
   * Puts this picture's prompt back in the composer, armed for image mode. The
   * composer is where prompts are written, so "edit" means "hand it back to the
   * one field that edits prompts" rather than opening a second editor here.
   */
  onEditPrompt: () => void
  onStop: () => void
}) {
  const [isPending, startTransition] = React.useTransition()
  const [lightbox, setLightbox] = React.useState(false)

  // The lightbox is a hand-rolled overlay rather than a Dialog — it has no
  // chrome to speak of — so Escape is wired here rather than inherited.
  React.useEffect(() => {
    if (!lightbox) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightbox(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [lightbox])

  const aspectRatio = job?.aspectRatio ?? image?.aspectRatio ?? "16:9"
  const ratio = aspectRatioValue(aspectRatio)

  function handleDelete() {
    if (!image) return
    const groupId = image.imageGroupId
    startTransition(async () => {
      const res = await deleteIllustration(storyId, groupId)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      // An undo action on the toast rather than a confirm dialog in front of
      // it. Deleting a picture is a soft delete either way, so the reversible
      // path is the honest one — and a modal asking "are you sure" about
      // something this recoverable is the kind of ceremony the manuscript is
      // deliberately free of. NOTE: not the ⌘Z journal, which only carries
      // passage ops; this Undo is the toast's own.
      toast("Illustration removed.", {
        action: {
          label: "Undo",
          onClick: () => {
            void restoreIllustration(storyId, groupId)
          },
        },
      })
    })
  }

  // While a job is running, the partial is the picture. Before the first
  // partial there is nothing to show, and the shimmer stands in for it.
  const src = job
    ? job.previewB64 && previewSrc(job.previewB64, job.mediaType)
    : image && `/api/images/${image.id}`

  const actions = image && !job
    ? [
        { key: "retry", icon: RefreshCw, label: "Retry image", onClick: onRetry },
        {
          key: "edit",
          icon: Pencil,
          label: "Edit prompt in composer",
          onClick: onEditPrompt,
        },
        {
          key: "delete",
          icon: Trash2,
          label: "Delete illustration",
          onClick: handleDelete,
        },
      ]
    : []

  return (
    <div
      // The cap lives on the WRAPPER, not the figure, so the hover cluster and
      // the take switcher stay pinned to the picture's real edges rather than
      // floating out over the prose beside a narrow one.
      //
      // Capping height by capping WIDTH is the only way to bound a portrait
      // frame without breaking its aspect ratio or cropping it: 9:16 at the
      // manuscript's full width is over a thousand pixels tall, and the writer
      // loses the prose on both sides of it. Landscape frames never reach the
      // cap and stay full width.
      style={{ maxWidth: `calc(70vh * ${ratio})` }}
      className="group/image relative mx-auto mt-3"
    >
      <figure
        style={{ aspectRatio: ratio }}
        className="relative w-full overflow-hidden bg-muted/40"
      >
        {/* Until there are pixels. Rendered behind the image rather than
            swapped for it, so nothing in the figure changes size or position
            when the picture lands — the frame was reserved at the requested
            aspect ratio precisely so it would not. */}
        {!src && <ImagePlaceholder />}

        {src && (
          // Not next/image: these bytes are user data behind a runtime route
          // with unknown intrinsic size, which is exactly the case the
          // optimizer cannot help with. eslint's rule is about layout shift,
          // and the figure's reserved aspect ratio already answers that.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={image?.prompt ?? "Illustration in progress"}
            className={cn(
              "h-full w-full object-cover transition-opacity duration-300",
              // A partial arriving is a sharpening, not a swap, so it must not
              // fade — only the very first one does, out of the shimmer.
              job && !job.previewB64 && "opacity-0"
            )}
            onClick={image && !job ? () => setLightbox(true) : undefined}
          />
        )}

        {job && (
          <div className="absolute top-2 right-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="secondary"
                    size="icon-xs"
                    aria-label="Stop generating"
                    onClick={onStop}
                  />
                }
              >
                <Square />
              </TooltipTrigger>
              {/* All-or-nothing billing, stated plainly: a writer who thinks a
                  stop still costs money will sit through pictures they don't
                  want. */}
              <TooltipContent>
                Stop — unfinished generations aren&apos;t billed
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </figure>

      {actions.length > 0 && (
        <div className="absolute top-2 right-2 flex items-center gap-0.5 border bg-background p-0.5 shadow-sm transition-opacity group-focus-within/image:pointer-events-auto group-focus-within/image:opacity-100 group-hover/image:pointer-events-auto group-hover/image:opacity-100 md:pointer-events-none md:opacity-0">
          {/* Rides the cluster's own reveal, exactly like a passage's cost —
              no second hover target, and no figure printed permanently under
              every picture. Absent when nothing was billed: the offline mock
              writes no ledger row, and a chip there would imply one exists. */}
          {image && image.callStatus !== null && (
            <>
              <ImageCostChip image={image} />
              <Separator orientation="vertical" className="mx-0.5 h-4" />
            </>
          )}
          {actions.map(({ key, icon: Icon, label, onClick }) => (
            <Tooltip key={key}>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={label}
                    disabled={busy || isPending}
                    onClick={onClick}
                  />
                }
              >
                <Icon />
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}

      {image && !job && image.imageCount > 1 && (
        <ImageVariantSwitcher
          image={image}
          storyId={storyId}
          disabled={busy || isPending}
        />
      )}

      {lightbox && image && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Illustration"
          onClick={() => setLightbox(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/images/${image.id}`}
            alt={image.prompt}
            className="max-h-full max-w-full object-contain"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 text-white"
            onClick={() => setLightbox(false)}
          >
            <X />
          </Button>
        </div>
      )}
    </div>
  )
}
