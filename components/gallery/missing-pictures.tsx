"use client"

import * as React from "react"
import Link from "next/link"
import { TriangleAlert } from "lucide-react"

import { formatRelativeDate } from "@/lib/format"
import type { GalleryImage } from "@/lib/types"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const STORAGE_KEY = "draft-zero:gallery-dismissed-missing"

const listeners = new Set<() => void>()

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  window.addEventListener("storage", onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener("storage", onChange)
  }
}

/**
 * The ids the reader has already dismissed, or null on the server. Null hides
 * the alert, so it does not flash on during hydration.
 */
function useDismissedMissing(): [Set<string> | null, (ids: string[]) => void] {
  const stored = React.useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(STORAGE_KEY) ?? "[]",
    () => null
  )

  const dismissed = React.useMemo(() => {
    if (stored === null) return null
    try {
      const ids: unknown = JSON.parse(stored)
      return new Set(Array.isArray(ids) ? ids.map(String) : [])
    } catch {
      return new Set<string>()
    }
  }, [stored])

  const dismiss = React.useCallback((ids: string[]) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
    listeners.forEach((notify) => notify())
  }, [])

  return [dismissed, dismiss]
}

/**
 * The gallery header's alert for pictures whose files are gone. They are kept
 * off the wall, and this lists them. Dismissing hides the alert until a picture
 * outside the dismissed set goes missing.
 */
export function MissingPictures({ images }: { images: GalleryImage[] }) {
  const [dismissed, dismiss] = useDismissedMissing()
  const [open, setOpen] = React.useState(false)

  const ids = images.map((image) => image.id)
  const fresh = dismissed !== null && ids.some((id) => !dismissed.has(id))
  if (!fresh && !open) return null

  const label = `${images.length} ${images.length === 1 ? "picture" : "pictures"} missing`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className="text-warning hover:text-warning aria-expanded:text-warning"
          />
        }
      >
        <TriangleAlert />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 max-w-(--available-width) gap-3 p-0"
      >
        <p className="px-4 pt-4 text-sm font-medium">{label}</p>
        <ul className="max-h-80 overflow-y-auto px-2">
          {images.map((image) => (
            <li key={image.id}>
              <Link
                href={`/story/${image.storyId}`}
                className="flex flex-col gap-0.5 rounded-sm px-2 py-2 hover:bg-muted"
              >
                <span className="flex items-baseline gap-2">
                  {image.tintHue !== null && (
                    <span
                      aria-hidden
                      className="tint-swatch size-2 shrink-0 self-center rounded-full"
                      style={
                        {
                          "--swatch-h": image.tintHue,
                          "--swatch-c": image.tintStrength,
                        } as React.CSSProperties
                      }
                    />
                  )}
                  <span className="truncate font-medium">
                    {image.storyTitle}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {formatRelativeDate(image.createdAt)}
                  </span>
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {image.prompt}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex justify-end border-t px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              dismiss(ids)
              setOpen(false)
            }}
          >
            Dismiss
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
