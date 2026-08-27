"use client"

import * as React from "react"
import { ChevronDown, RefreshCw } from "lucide-react"

import type { OpenRouterImageModel } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ImageModelCommandList } from "@/components/inspector/image-model-select"

/**
 * What the image retry menu needs to know, supplied once for the whole editor.
 *
 * A context for the same reason RetryProfiles is one: the control sits in a
 * picture's hover cluster deep inside the canvas, and the canvas between has
 * no interest in the image catalog. Threading it through would put three props
 * on three components to serve one menu.
 */
export interface ImageRetryModels {
  models: OpenRouterImageModel[]
  /** The story's effective retention policy — the menu greys what it rules out. */
  zdr: boolean
  /** What plain Retry draws with: the story's choice, or the app default. */
  currentModelId: string
}

const ImageRetryModelsContext = React.createContext<ImageRetryModels | null>(
  null
)

export function ImageRetryModelsProvider({
  value,
  children,
}: {
  value: ImageRetryModels
  children: React.ReactNode
}) {
  return (
    <ImageRetryModelsContext.Provider value={value}>
      {children}
    </ImageRetryModelsContext.Provider>
  )
}

/**
 * Retry, with a caret beside it that redraws the same take under a different
 * image model — the picture-shaped twin of the text side's RetryButton.
 *
 * The plain button is untouched: one click still redraws under the story's
 * current model, because that is what a writer rolling for a better picture
 * wants, and the model list is a different question. The caret opens a
 * SEARCHABLE list rather than the text side's flat profile menu, because the
 * catalog is forty-eight models rather than a handful of profiles — and it is
 * the picker's own list component, so the menu and the inspector can never
 * disagree about grouping or what a retention policy rules out.
 *
 * No reveal-on-hover for the caret: this cluster is itself hover-revealed at
 * md and up, so the pair appears together, and on touch — where the cluster is
 * permanently visible — a hidden caret would be unreachable, which is the
 * exact bug the cost chip just had.
 */
export function ImageRetryButton({
  disabled,
  onRetry,
  onRetryWithModel,
}: {
  disabled: boolean
  /** Redraw under the story's current model — the plain half. */
  onRetry: () => void
  /** Redraw this take under the named model, story choice untouched. */
  onRetryWithModel: (modelId: string) => void
}) {
  const context = React.useContext(ImageRetryModelsContext)
  const [open, setOpen] = React.useState(false)

  const currentName = context?.models.find(
    (model) => model.id === context.currentModelId
  )?.name

  return (
    <span className="group/retry relative inline-flex items-center">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Retry image"
              disabled={disabled}
              onClick={onRetry}
            />
          }
        >
          <RefreshCw />
        </TooltipTrigger>
        <TooltipContent>Retry image</TooltipContent>
      </Tooltip>

      {context && context.models.length > 1 && (
        <Popover open={open} onOpenChange={setOpen}>
          {/* No tooltip on the caret, same as the text RetryButton and for the
              same reason: a base-ui trigger owns its element's handlers, and a
              TooltipTrigger wrapper would quietly swallow them. */}
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon-caret-xs"
                aria-label="Retry with a different model"
                disabled={disabled}
                // The hairline is the only thing saying these two buttons are
                // one control; it arrives with the hover fill they share.
                className={cn(
                  "border-l border-transparent transition-opacity group-hover/retry:border-border"
                )}
              />
            }
          >
            <ChevronDown />
          </PopoverTrigger>
          {/* The height is clamped on the POPUP, not just the list. The list
              carries its own max-height, but this menu is the one place the
              whole popup must never exceed the screen — a caret anchored to a
              picture can open with the entire viewport as available room, and
              a constraint that lives only on an inner flex child has lost on
              WebKit before. Belt on the popup, braces on the list; min-h-0 on
              the list is what lets it actually shrink inside the flex column,
              and the footer is shrink-0 so clamping never eats the promise. */}
          <PopoverContent
            align="end"
            className="max-h-[min(24rem,calc(100dvh-2rem))] w-72 gap-0 overflow-hidden p-0"
            sideOffset={4}
          >
            <Command className="max-h-full">
              <CommandInput placeholder="Redraw with…" />
              <CommandList className="min-h-0">
                <CommandEmpty>No image model found.</CommandEmpty>
                <ImageModelCommandList
                  models={context.models}
                  zdr={context.zdr}
                  checkedId={context.currentModelId}
                  onSelect={(modelId) => {
                    setOpen(false)
                    onRetryWithModel(modelId)
                  }}
                />
              </CommandList>
              {/* The promise this control lives or dies by, word for word the
                  text menu's: trying a model on one picture must not quietly
                  re-point the story. */}
              <p className="shrink-0 border-t px-3 py-2 text-xs text-muted-foreground">
                This take only. The story keeps drawing with{" "}
                <span className="font-medium text-foreground">
                  {currentName ?? context.currentModelId}
                </span>
                .
              </p>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </span>
  )
}
