"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { formatRelativeDate } from "@/lib/format"
import type { StoryView } from "@/lib/store/store"
import { useElapsed } from "@/hooks/use-elapsed"
import type { RunStatus } from "@/hooks/use-run-status"
import { tintVars } from "@/components/library/tint"

/**
 * The front door's one job: the story you were last in, and the prose you were
 * in the middle of.
 *
 * This is the block the sidebar cannot be — a 240px rail has room for a title
 * and a date, and what gets somebody back into a manuscript is the manuscript.
 * The excerpt is the TAIL of the latest passage (see listStoryExcerpts), so it
 * ends where the writing does and reads straight into the composer.
 *
 * One link over the whole card rather than a title link and a Continue button:
 * two controls that go to the same place are two things to aim at and one
 * confusing tab stop. The pill is a painted affordance, not a control.
 */
export function ContinueCard({
  story,
  excerpt,
  run,
}: {
  story: StoryView
  excerpt?: string
  run: RunStatus
}) {
  const elapsed = useElapsed(run.state === "working" ? run.startedAt : null)
  const meta =
    run.state === "working"
      ? elapsed === null
        ? "writing now"
        : `writing · ${elapsed}`
      : formatRelativeDate(story.updatedAt)

  return (
    <Link
      href={`/story/${story.id}`}
      prefetch={true}
      className="story-card group block rounded-xl border border-border/60 bg-card/40 px-4 py-4 transition-colors outline-none hover:border-border hover:bg-card/80 focus-visible:ring-2 focus-visible:ring-ring/30 sm:px-5"
      style={tintVars(story)}
    >
      <span className="block text-[0.625rem] tracking-[0.14em] text-muted-foreground uppercase">
        Continue
      </span>
      <span className="mt-1.5 block truncate font-serif text-lg tracking-tight">
        {story.title}
      </span>
      {excerpt ? (
        // line-clamp rather than a character budget: the tail arrives cut to a
        // word already, and how many of those words fit is a question about
        // this screen's width, which CSS is the only one here that knows.
        <span className="mt-2.5 line-clamp-3 font-serif text-[0.9375rem] leading-relaxed text-foreground/75">
          {excerpt}
        </span>
      ) : (
        <span className="mt-2.5 block font-serif text-[0.9375rem] leading-relaxed text-muted-foreground">
          Nothing written yet. Open it and start.
        </span>
      )}
      <span className="mt-3.5 flex items-center gap-3">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {meta}
          {story.wordCount > 0
            ? ` · ${story.wordCount.toLocaleString()} words`
            : ""}
        </span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
          Continue
          <ArrowRight className="size-3.5" />
        </span>
      </span>
    </Link>
  )
}
