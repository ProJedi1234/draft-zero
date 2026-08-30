"use client"

import * as React from "react"
import Link from "next/link"

import type { GalleryImage } from "@/lib/types"
import { cn } from "@/lib/utils"
import { GalleryLightbox } from "@/components/gallery/gallery-lightbox"

/**
 * The newest illustrations in the library, as a rail across the front door.
 *
 * Here rather than merged with /gallery: the wall answers "show me everything"
 * and this answers "what has this place made lately", and they are different
 * questions that happen to share rows. "Gallery →" is the door to the other
 * one.
 *
 * A tile opens the same lightbox the wall uses, over the rail's own pictures —
 * the overlay only needs a rect to fly out of and back into, and a rail tile
 * has one exactly like a wall tile does. Sending a tap to /gallery instead
 * would answer a picture with a page.
 */
export function PictureRail({
  images,
  onViewerChange,
}: {
  images: GalleryImage[]
  /**
   * Raised while the lightbox is up, so the page behind can be pinned. The
   * close flight animates to a tile's on-screen rect, and a page that scrolled
   * underneath would land the picture somewhere else.
   */
  onViewerChange?: (open: boolean) => void
}) {
  const [viewerIndex, setViewerIndex] = React.useState<number | null>(null)
  const scrollerRef = React.useRef<HTMLDivElement>(null)
  // Keyed by SLOT rather than by row id, like the wall's: promoting a take from
  // the lightbox changes which row a tile shows, and a flight home must not be
  // looking for the take it replaced.
  const cellRefs = React.useRef(new Map<string, HTMLButtonElement>())

  const open = viewerIndex !== null
  React.useEffect(() => {
    onViewerChange?.(open)
  }, [open, onViewerChange])

  const registerCell = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) cellRefs.current.set(id, el)
    else cellRefs.current.delete(id)
  }

  const rectFor = React.useCallback(
    (id: string) => cellRefs.current.get(id)?.getBoundingClientRect() ?? null,
    []
  )

  // inline as well as block: this wall is one row wide, so the tile a close
  // flies home to is usually off the side rather than off the bottom.
  const scrollCellTo = React.useCallback((id: string) => {
    cellRefs.current
      .get(id)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [])

  const closeViewer = React.useCallback(() => {
    if (viewerIndex !== null) {
      const image = images[viewerIndex]
      if (image) cellRefs.current.get(image.imageGroupId)?.focus()
    }
    setViewerIndex(null)
  }, [images, viewerIndex])

  if (images.length === 0) return null

  return (
    <section className="mt-7">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-[0.625rem] tracking-[0.14em] text-muted-foreground uppercase">
          Recent pictures
        </h2>
        <Link
          href="/gallery"
          className="ml-auto text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Gallery →
        </Link>
      </div>
      {/* The negative margins let the rail bleed to the screen edge on a phone
          so a half-tile shows at the cut, which is what says "there is more".
          It scrolls in its own frame; the page itself must never move
          sideways. */}
      <div
        ref={scrollerRef}
        className={cn(
          "-mx-4 [scrollbar-width:none] overflow-x-auto px-4 sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden",
          // Held still for the same reason the page is: a rail that scrolled
          // under the overlay would move the rect the picture flies home to.
          open && "overflow-hidden"
        )}
      >
        <div className="flex w-max gap-1.5">
          {images.map((image, index) => {
            // The tile is the slot, so it is out on the lightbox no matter
            // which of its takes the lightbox is currently showing.
            const isOut =
              viewerIndex !== null &&
              images[viewerIndex]?.imageGroupId === image.imageGroupId
            return (
              <button
                key={image.imageGroupId}
                ref={registerCell(image.imageGroupId)}
                type="button"
                aria-label={image.prompt}
                onClick={() => setViewerIndex(index)}
                className="size-20 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted/40 outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/images/${image.id}`}
                  alt={image.prompt}
                  loading="lazy"
                  decoding="async"
                  className={cn(
                    "h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-300 motion-safe:hover:scale-[1.04]",
                    // The open tile goes dark while its picture is out: the
                    // flying figure covers this exact rectangle.
                    isOut && "opacity-0"
                  )}
                />
              </button>
            )
          })}
        </div>
      </div>

      {viewerIndex !== null && images[viewerIndex] && (
        <GalleryLightbox
          images={images}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={closeViewer}
          rectFor={rectFor}
          scrollCellTo={scrollCellTo}
        />
      )}
    </section>
  )
}
