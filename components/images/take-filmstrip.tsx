"use client"

import * as React from "react"
import { Check } from "lucide-react"

import type { ImageTake } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * A picture's draws, as thumbnails, for a lightbox to lay over its scrim.
 *
 * The full-screen counterpart to ImageVariantSwitcher. The switcher steps one
 * take at a time because a caption line has room for exactly "‹ 2 / 3 ›" and
 * nothing else; with the whole viewport in hand there is no reason to make a
 * writer step blindly through five draws to find the one they remember.
 *
 * Deliberately a themed surface rather than the white-on-black the scrims
 * around it use. A scrim is dark because a photograph wants a dark room, but
 * this is a control cluster, and it wears the same glass the manuscript's own
 * hover cluster does so that light mode stays light mode inside the lightbox.
 */
export function TakeFilmstrip({
  takes,
  activeIndex,
  shownIndex,
  onShow,
  onPromote,
  disabled = false,
  className,
}: {
  takes: ImageTake[]
  /** The take the manuscript is currently using. */
  activeIndex: number
  /** The take on screen, which is not always the active one. */
  shownIndex: number
  onShow: (index: number) => void
  /** Makes the shown take the active one. Absent where promoting isn't offered. */
  onPromote?: () => void
  disabled?: boolean
  className?: string
}) {
  if (takes.length < 2) return null

  return (
    <div
      className={cn(
        "flex items-center gap-1 overflow-x-auto rounded-lg border bg-background/90 p-1 shadow-lg backdrop-blur-md",
        className
      )}
    >
      {takes.map((take, at) => (
        <Tooltip key={take.id}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`Draw ${at + 1} of ${takes.length}${
                  at === activeIndex ? ", in the story" : ""
                }`}
                aria-current={at === shownIndex}
                disabled={disabled}
                onClick={() => onShow(at)}
                className={cn(
                  "relative size-12 shrink-0 overflow-hidden rounded-sm bg-muted outline-none",
                  at === shownIndex
                    ? "ring-2 ring-ring"
                    : "opacity-55 transition-opacity hover:opacity-100 focus-visible:opacity-100"
                )}
              />
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/images/${take.id}`}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
            {/* Which draw the manuscript is actually using. A dot rather than a
                second ring: the ring already means "you are looking at this
                one", and the two facts are independent — the whole point of
                promoting is that they can disagree. */}
            {at === activeIndex && (
              <span
                aria-hidden
                className="absolute right-1 bottom-1 size-1.5 rounded-full bg-primary ring-1 ring-background"
              />
            )}
          </TooltipTrigger>
          <TooltipContent className="flex-col items-start gap-0.5">
            <span className="font-mono">{take.modelId}</span>
            <span className="text-background/70">
              {take.aspectRatio} · seed {take.seed}
              {at === activeIndex && " · in the story"}
            </span>
          </TooltipContent>
        </Tooltip>
      ))}

      {onPromote && shownIndex !== activeIndex && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Use this draw in the story"
                disabled={disabled}
                onClick={onPromote}
                className="ml-0.5 shrink-0"
              />
            }
          >
            <Check />
          </TooltipTrigger>
          <TooltipContent>Use this draw in the story</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
