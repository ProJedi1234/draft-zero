"use client"

import * as React from "react"
import Link from "next/link"
import { GalleryVerticalEnd, Images, LayoutGrid, Layers } from "lucide-react"

import { aspectRatioValue, type GalleryImage } from "@/lib/types"
import { cn } from "@/lib/utils"
import { layoutWaterfall, type TilePlacement } from "@/lib/waterfall"
import { OfflineChip } from "@/components/offline/offline-chip"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { GalleryLightbox } from "@/components/gallery/gallery-lightbox"

/** Space between tiles, and around the wall's edge, in CSS pixels. */
const GAP = 4

/** One story's run of tiles, in the wall's own order. */
interface StorySection {
  storyId: string
  storyTitle: string
  tintHue: number | null
  tintStrength: number
  images: GalleryImage[]
}

/**
 * The gallery: every illustration in the library as a waterfall wall, each
 * tile at its picture's own ratio (see lib/waterfall.ts), with an optional
 * group-by-story view and a lightbox that a tile opens into.
 *
 * Grouping happens here rather than in SQL because it is presentation state —
 * the same rows serve both views, and the toggle must not cost a round trip.
 * Sections come out in first-appearance order, which over a newest-first list
 * means "stories with the newest pictures first" without a second sort key.
 */
export function PhotoWall({ images }: { images: GalleryImage[] }) {
  const [grouped, setGrouped] = React.useState(false)
  const [viewerIndex, setViewerIndex] = React.useState<number | null>(null)

  // The lightbox flies out of (and back into) a tile, so it needs the live
  // element for any tile — a ref map kept by each tile, keyed by SLOT rather
  // than by row id: promoting a take from the lightbox changes which row a tile
  // shows, and a flight home must not be looking for the take it replaced.
  const cellRefs = React.useRef(new Map<string, HTMLButtonElement>())

  // Null until measured, and nothing is placed until then: a guessed width
  // would paint one column count and snap to another a frame later.
  const [wallWidth, setWallWidth] = React.useState<number | null>(null)
  const measureWall = React.useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    setWallWidth(el.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) =>
      setWallWidth(entry.contentRect.width)
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const sections = React.useMemo<StorySection[]>(() => {
    const byStory = new Map<string, StorySection>()
    for (const image of images) {
      let section = byStory.get(image.storyId)
      if (!section) {
        section = {
          storyId: image.storyId,
          storyTitle: image.storyTitle,
          tintHue: image.tintHue,
          tintStrength: image.tintStrength,
          images: [],
        }
        byStory.set(image.storyId, section)
      }
      section.images.push(image)
    }
    return [...byStory.values()]
  }, [images])

  // The lightbox navigates the wall as displayed, so its index space is the
  // flattened current view — identical to `images` when the wall is flat.
  const ordered = React.useMemo(
    () => (grouped ? sections.flatMap((s) => s.images) : images),
    [grouped, sections, images]
  )

  const viewerImage = viewerIndex === null ? null : ordered[viewerIndex]

  const registerCell = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) cellRefs.current.set(id, el)
    else cellRefs.current.delete(id)
  }

  const rectFor = React.useCallback(
    (id: string) => cellRefs.current.get(id)?.getBoundingClientRect() ?? null,
    []
  )

  const scrollCellTo = React.useCallback((id: string) => {
    cellRefs.current.get(id)?.scrollIntoView({ block: "nearest" })
  }, [])

  const closeViewer = React.useCallback(() => {
    if (viewerIndex !== null) {
      const image = ordered[viewerIndex]
      if (image) cellRefs.current.get(image.imageGroupId)?.focus()
    }
    setViewerIndex(null)
  }, [ordered, viewerIndex])

  const openViewer = (image: GalleryImage) => {
    const index = ordered.indexOf(image)
    if (index >= 0) setViewerIndex(index)
  }

  const renderCell = (image: GalleryImage, placement: TilePlacement) => {
    // The tile is the slot, so it is out on the lightbox no matter which of its
    // takes the lightbox is currently showing.
    const isOut = viewerImage?.imageGroupId === image.imageGroupId
    return (
      <button
        key={image.imageGroupId}
        ref={registerCell(image.imageGroupId)}
        type="button"
        aria-label={
          image.takes.length > 1
            ? `${image.prompt} (${image.takes.length} draws)`
            : image.prompt
        }
        onClick={() => openViewer(image)}
        style={placement}
        className="group/cell absolute overflow-hidden bg-muted/40 outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/images/${image.id}`}
          alt={image.prompt}
          loading="lazy"
          decoding="async"
          className={cn(
            "h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover/cell:scale-[1.04]",
            // The open tile goes dark while its picture is out on the lightbox —
            // the flying figure covers this exact rectangle, and on close it
            // lands back here before the tile reappears.
            isOut && "opacity-0"
          )}
        />
        {/* The wall's answer to the manuscript's "‹ 2 / 3 ›": a retried picture
            must say so where it is seen, or the wall quietly implies retrying
            threw the earlier draws away. Passive rather than a view toggle,
            because a mode you have to know about cannot tell you a thing
            exists. */}
        {image.takes.length > 1 && !isOut && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 text-xs leading-none font-medium text-white tabular-nums backdrop-blur-sm"
          >
            <Layers className="size-3" />
            {image.takes.length}
          </span>
        )}
      </button>
    )
  }

  const wall = (tiles: GalleryImage[]) => {
    if (wallWidth === null) return null
    const layout = layoutWaterfall(
      tiles.map((image) => aspectRatioValue(image.aspectRatio)),
      wallWidth,
      GAP
    )
    return (
      <div className="relative" style={{ height: layout.height }}>
        {tiles.map((image, i) => renderCell(image, layout.tiles[i]))}
      </div>
    )
  }

  return (
    <div className="flex h-app flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger />
        <h1 className="text-sm font-medium">Gallery</h1>
        <div className="flex-1" />
        <OfflineChip />
        {images.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {images.length} {images.length === 1 ? "image" : "images"}
          </span>
        )}
        {sections.length > 1 && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={grouped ? "Show as one wall" : "Group by story"}
                  aria-pressed={grouped}
                  onClick={() => setGrouped((value) => !value)}
                />
              }
            >
              {grouped ? <LayoutGrid /> : <GalleryVerticalEnd />}
            </TooltipTrigger>
            <TooltipContent>
              {grouped ? "Show as one wall" : "Group by story"}
            </TooltipContent>
          </Tooltip>
        )}
      </header>

      {images.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Images />
              </EmptyMedia>
              <EmptyTitle>No illustrations yet</EmptyTitle>
              <EmptyDescription>
                Ask any story for a picture and it lands here too.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <div
          className={cn(
            // A stable gutter, because the wall's width sets its column count:
            // a scrollbar appearing, or vanishing under the lock below, would
            // otherwise reflow every tile.
            "min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto",
            // The wall must hold still while the lightbox is up: the close
            // animation targets a tile's on-screen rectangle, and a wall that
            // scrolled underneath would make the picture land somewhere else.
            viewerIndex !== null && "overflow-hidden"
          )}
        >
          <div
            style={{
              padding: GAP,
              paddingBottom: `calc(${GAP}px + env(safe-area-inset-bottom))`,
            }}
          >
            <div ref={measureWall}>
              {grouped
                ? sections.map((section) => (
                    <section key={section.storyId}>
                      <div className="flex items-baseline gap-2 px-3 pt-4 pb-2">
                        {section.tintHue !== null && (
                          <span
                            aria-hidden
                            className="tint-swatch size-2 shrink-0 self-center rounded-full"
                            style={
                              {
                                "--swatch-h": section.tintHue,
                                "--swatch-c": section.tintStrength,
                              } as React.CSSProperties
                            }
                          />
                        )}
                        <Link
                          href={`/story/${section.storyId}`}
                          className="truncate text-sm font-medium hover:underline"
                        >
                          {section.storyTitle}
                        </Link>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {section.images.length}
                        </span>
                      </div>
                      {wall(section.images)}
                    </section>
                  ))
                : wall(images)}
            </div>
          </div>
        </div>
      )}

      {viewerIndex !== null && viewerImage && (
        <GalleryLightbox
          images={ordered}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={closeViewer}
          rectFor={rectFor}
          scrollCellTo={scrollCellTo}
        />
      )}
    </div>
  )
}
