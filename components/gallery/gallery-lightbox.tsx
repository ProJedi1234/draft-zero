"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowUpRight, ChevronLeft, ChevronRight, X } from "lucide-react"
import { toast } from "sonner"

import { selectImageById } from "@/lib/actions/images"
import { formatRelativeDate } from "@/lib/format"
import { aspectRatioValue, type GalleryImage } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { TakeFilmstrip } from "@/components/images/take-filmstrip"

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

/** A rect as WAAPI keyframe properties — units included, or the frames no-op. */
function frame(rect: Rect): Keyframe {
  return {
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  }
}

/**
 * Where a picture of this aspect ratio rests: fitted into the viewport with
 * room below for the caption scrim, centred in what remains. Computed from the
 * DECLARED ratio rather than the loaded pixels so the frame is known before
 * the large image arrives — the same reserve-the-frame rule the manuscript
 * follows.
 */
function restingRect(ratio: number, vw: number, vh: number): Rect {
  const maxWidth = vw - 32
  const maxHeight = vh - 136
  let width = maxWidth
  let height = width / ratio
  if (height > maxHeight) {
    height = maxHeight
    width = height * ratio
  }
  return {
    top: 24 + (maxHeight - height) / 2,
    left: (vw - width) / 2,
    width,
    height,
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

const FLIGHT_EASING = "cubic-bezier(0.22, 1, 0.36, 1)"

/**
 * The wall's lightbox: a tile flies out to its resting rect, and flies home on
 * close.
 *
 * The flight is a rect morph (top/left/width/height under WAAPI), not a
 * transform — a square tile and a 16:9 rest frame have different shapes, and a
 * transform between them would smear the picture. Morphing the rect while the
 * img inside keeps object-cover gives the iOS-Photos uncropping instead: the
 * frame un-squares mid-flight and the crop falls away with it, meeting the
 * full picture exactly when the rect reaches the image's own ratio.
 *
 * Navigation stays inside the one overlay: the rect transitions between
 * ratios via CSS, the img crossfades by key, and the wall underneath scrolls
 * its hidden tile into view so a close always has a home to fly to.
 */
export function GalleryLightbox({
  images,
  index,
  onIndexChange,
  onClose,
  rectFor,
  scrollCellTo,
}: {
  images: GalleryImage[]
  index: number
  onIndexChange: (index: number) => void
  /** Unmounts the lightbox; called only after the close flight has landed. */
  onClose: () => void
  /** The on-screen rect of an image's wall tile, or null if it has no tile. */
  rectFor: (id: string) => DOMRect | null
  /** Brings an image's tile into the wall's viewport, for the close flight. */
  scrollCellTo: (id: string) => void
}) {
  const image = images[index]

  // Which take of the current slot is on screen. Held as {slot, index} rather
  // than a bare number so that navigating to another picture falls back to its
  // active take with no effect and no frame of the wrong image — the slot ids
  // simply stop matching.
  const [shown, setShown] = React.useState<{
    imageGroupId: string
    takeIndex: number
  } | null>(null)
  const [isPromoting, startPromoting] = React.useTransition()

  const takeIndex =
    shown?.imageGroupId === image.imageGroupId
      ? Math.min(shown.takeIndex, image.takes.length - 1)
      : image.imageIndex
  const take = image.takes[takeIndex] ?? image.takes[image.imageIndex]

  const ratio = aspectRatioValue(take.aspectRatio)

  const overlayRef = React.useRef<HTMLDivElement>(null)
  const backdropRef = React.useRef<HTMLDivElement>(null)
  const figureRef = React.useRef<HTMLDivElement>(null)
  const chromeRef = React.useRef<HTMLDivElement>(null)
  const closingRef = React.useRef(false)
  // The take the overlay opened on: its img must not run the crossfade, which
  // would blank the picture for the whole opening flight.
  const [openedOn] = React.useState(take.id)
  // Tiles are keyed by slot, not by row — a promote swaps which take a tile
  // shows, and the flight home must still find it.
  const homeKey = image.imageGroupId

  // Rect is derived, not stored: the inputs are the picture's ratio and the
  // viewport, and only the viewport needs an event to be re-read.
  const [viewport, setViewport] = React.useState(() => ({
    vw: window.innerWidth,
    vh: window.innerHeight,
  }))
  const rect = React.useMemo(
    () => restingRect(ratio, viewport.vw, viewport.vh),
    [ratio, viewport]
  )

  React.useEffect(() => {
    const onResize = () => {
      // Not while pinch-zoomed: on iOS innerWidth/innerHeight track the VISUAL
      // viewport, so a zoom would shrink the resting rect and walk the picture
      // off into a corner, chased by the rect transition.
      if ((window.visualViewport?.scale ?? 1) > 1) return
      setViewport({ vw: window.innerWidth, vh: window.innerHeight })
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // The opening flight, from the clicked tile to the resting rect. Layout
  // effect, not effect: the first painted frame must already be mid-flight,
  // never a flash of the fully open state.
  React.useLayoutEffect(() => {
    const figure = figureRef.current
    const backdrop = backdropRef.current
    const chrome = chromeRef.current
    if (!figure || !backdrop || !chrome) return
    overlayRef.current?.focus()
    if (prefersReducedMotion()) return
    const from = rectFor(homeKey)
    if (from) {
      figure.animate([frame(from), frame(rect)], {
        duration: 340,
        easing: FLIGHT_EASING,
      })
    } else {
      figure.animate(
        [
          { opacity: 0, transform: "scale(0.97)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: 200, easing: "ease-out" }
      )
    }
    for (const el of [backdrop, chrome]) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 260,
        easing: "ease-out",
      })
    }
    // Mount-only by design: this is the entrance, and the deps it reads are
    // frozen refs plus the mount-time image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const close = React.useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    const figure = figureRef.current
    const backdrop = backdropRef.current
    const chrome = chromeRef.current
    const home = rectFor(homeKey)
    if (!figure || !backdrop || !chrome || prefersReducedMotion()) {
      onClose()
      return
    }
    const flight = home
      ? figure.animate([frame(rect), frame(home)], {
          duration: 300,
          easing: "cubic-bezier(0.32, 0.72, 0, 1)",
          fill: "forwards",
        })
      : figure.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 180,
          easing: "ease-in",
          fill: "forwards",
        })
    for (const el of [backdrop, chrome]) {
      el.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: home ? 300 : 180,
        easing: "ease-in",
        fill: "forwards",
      })
    }
    flight.finished.then(onClose, onClose)
  }, [homeKey, onClose, rect, rectFor])

  const goTo = React.useCallback(
    (next: number) => {
      if (closingRef.current) return
      if (next < 0 || next >= images.length) return
      onIndexChange(next)
    },
    [images.length, onIndexChange]
  )

  const goToTake = React.useCallback(
    (next: number) => {
      if (closingRef.current) return
      if (next < 0 || next >= image.takes.length) return
      setShown({ imageGroupId: image.imageGroupId, takeIndex: next })
    },
    [image.imageGroupId, image.takes.length]
  )

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
      else if (event.key === "ArrowRight") goTo(index + 1)
      else if (event.key === "ArrowLeft") goTo(index - 1)
      // The second axis: left/right crosses the wall, up/down goes through one
      // picture's takes. Deliberately NOT mirrored as a vertical swipe on
      // touch, where a drag down a full-screen photo reads as dismiss.
      else if (event.key === "ArrowDown") goToTake(takeIndex + 1)
      else if (event.key === "ArrowUp") goToTake(takeIndex - 1)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [close, goTo, goToTake, index, takeIndex])

  function promote() {
    startPromoting(async () => {
      const res = await selectImageById(
        image.storyId,
        image.imageGroupId,
        take.id
      )
      // Silent on success: the check clearing and the dot moving is the
      // confirmation, the same way the canvas's switcher says nothing.
      if (!res.ok) toast.error(res.error)
    })
  }

  // Keep the wall's (hidden) tile for the current picture on screen, so the
  // close flight always has somewhere real to land — and warm the neighbours'
  // caches so arrow keys feel instant.
  React.useEffect(() => {
    scrollCellTo(homeKey)
    for (const neighbour of [images[index - 1], images[index + 1]]) {
      if (neighbour) new window.Image().src = `/api/images/${neighbour.id}`
    }
  }, [homeKey, images, index, scrollCellTo])

  // Swipe navigates, a plain tap closes — split by how far the pointer moved,
  // with the decision made on pointer-up and the click that follows swallowed.
  const pointerStart = React.useRef<{ x: number; y: number } | null>(null)
  const swallowClick = React.useRef(false)

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.isPrimary)
      pointerStart.current = { x: event.clientX, y: event.clientY }
  }

  const onPointerUp = (event: React.PointerEvent) => {
    const start = pointerStart.current
    pointerStart.current = null
    if (!start || !event.isPrimary) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      goTo(dx < 0 ? index + 1 : index - 1)
      swallowClick.current = true
    }
  }

  const onOverlayClick = () => {
    if (swallowClick.current) {
      swallowClick.current = false
      return
    }
    close()
  }

  const stop = (event: React.SyntheticEvent) => event.stopPropagation()

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Illustration"
      tabIndex={-1}
      className="fixed inset-0 z-50 outline-none"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onClick={onOverlayClick}
    >
      <div
        ref={backdropRef}
        className="absolute inset-0 bg-black/90 backdrop-blur-sm"
      />

      <div
        ref={figureRef}
        style={rect}
        className="fixed overflow-hidden bg-black/40 motion-safe:transition-[top,left,width,height] motion-safe:duration-300 motion-safe:ease-out"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={take.id}
          src={`/api/images/${take.id}`}
          alt={take.prompt}
          className={cn(
            "h-full w-full object-cover",
            take.id !== openedOn &&
              "motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in"
          )}
        />
      </div>

      <div ref={chromeRef} className="pointer-events-none absolute inset-0">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          className="pointer-events-auto absolute top-[max(0.75rem,env(safe-area-inset-top))] right-4 text-white hover:bg-white/10 hover:text-white"
          onClick={(event) => {
            stop(event)
            close()
          }}
        >
          <X />
        </Button>

        {index > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous image"
            className="pointer-events-auto absolute top-1/2 left-3 hidden -translate-y-1/2 text-white hover:bg-white/10 hover:text-white sm:inline-flex"
            onClick={(event) => {
              stop(event)
              goTo(index - 1)
            }}
          >
            <ChevronLeft />
          </Button>
        )}
        {index < images.length - 1 && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next image"
            className="pointer-events-auto absolute top-1/2 right-3 hidden -translate-y-1/2 text-white hover:bg-white/10 hover:text-white sm:inline-flex"
            onClick={(event) => {
              stop(event)
              goTo(index + 1)
            }}
          >
            <ChevronRight />
          </Button>
        )}

        <div
          className="pointer-events-auto absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent px-4 pt-10 pb-[max(1rem,env(safe-area-inset-bottom))]"
          onClick={stop}
        >
          <div className="mx-auto max-w-3xl">
            {/* Where a retry actually becomes reachable: the wall's badge
                says a slot has more, and this is the "more". */}
            <TakeFilmstrip
              takes={image.takes}
              activeIndex={image.imageIndex}
              shownIndex={takeIndex}
              onShow={goToTake}
              onPromote={promote}
              disabled={isPromoting}
              className="mb-3 w-fit"
            />

            <div className="flex items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm text-white">{take.prompt}</p>
                <p className="mt-0.5 truncate text-xs text-white/60">
                  {image.storyTitle} · {formatRelativeDate(take.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-white/60 tabular-nums">
                  {index + 1} / {images.length}
                </span>
                {/* The trigger IS the link, styled as a button — same shape as
                  the story header's lorebook link, and for the same reason:
                  Base UI's Button insists on a native <button>, which an <a>
                  is not. */}
                <Tooltip>
                  <TooltipTrigger
                    className={buttonVariants({
                      variant: "ghost",
                      size: "icon-sm",
                      className:
                        "text-white hover:bg-white/10 hover:text-white",
                    })}
                    aria-label="Open story"
                    render={<Link href={`/story/${image.storyId}`} />}
                  >
                    <ArrowUpRight />
                  </TooltipTrigger>
                  <TooltipContent>Open story</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
