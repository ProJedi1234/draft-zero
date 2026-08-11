import { InlineMarkdown } from "@/components/inline-markdown"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { LoreMatch } from "@/lib/generation/lorebook"

/**
 * One active lorebook entry in the inspector's Lore tab.
 *
 * Read-only: it shows *why* the entry is in context — the trigger key that was
 * found in recent story text is emphasized, or an "Always" chip stands in when
 * the entry is included purely because it is always-active.
 */
export function LoreEntryCard({ match }: { match: LoreMatch }) {
  const { entry, matchedKey } = match
  const otherKeys = entry.keys.filter((key) => key !== matchedKey)
  const content = entry.content.trim()

  return (
    <div className="space-y-1.5 border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{entry.name}</span>
        <Badge variant="outline" className="shrink-0 capitalize">
          {entry.category}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {matchedKey === null ? (
          <Badge
            variant="secondary"
            className="bg-muted px-1.5 py-0.5 text-[10px]"
          >
            Always
          </Badge>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Badge
                  variant="default"
                  className="bg-primary/15 px-1.5 py-0.5 text-[10px] text-foreground"
                />
              }
              tabIndex={0}
            >
              {matchedKey}
            </TooltipTrigger>
            <TooltipContent>Matched in recent story text</TooltipContent>
          </Tooltip>
        )}

        {otherKeys.map((key) => (
          <Badge key={key} variant="secondary" className="text-[10px]">
            {key}
          </Badge>
        ))}
      </div>

      {/* One clamped run, not paragraphs: this is a two-line preview, so blank
          lines collapse to whitespace exactly as they did before. */}
      {content !== "" ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          <InlineMarkdown text={content} />
        </p>
      ) : null}
    </div>
  )
}
