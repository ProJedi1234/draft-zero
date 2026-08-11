// components/story/prose.tsx — The manuscript's type spec, in one place.
//
// Every surface that shows story text (persisted passages, the optimistic echo,
// the in-flight stream) renders through this file, so the serif spec and the
// paragraph rhythm are defined once. Divergence here shows up as a layout shift
// the moment a streamed passage is replaced by its persisted row.
//
// The inline marks themselves come from <InlineMarkdown>, which is shared with
// the lorebook and carries no typography of its own.

import * as React from "react"

import { InlineMarkdown } from "@/components/inline-markdown"
import { toParagraphs } from "@/lib/markdown"

export const PARAGRAPH_CLASS =
  "font-serif text-[1.0625rem] leading-8 text-foreground [&:not(:first-child)]:mt-5"

/** A single paragraph of manuscript prose. */
export function ProseParagraph({
  text,
  children,
}: {
  text: string
  /** Trailing content inside the paragraph — the streaming caret. */
  children?: React.ReactNode
}) {
  return (
    <p className={PARAGRAPH_CLASS}>
      <InlineMarkdown text={text} />
      {children}
    </p>
  )
}

/** A block of manuscript text: blank-line paragraphs, inline markdown within. */
export function Prose({ text }: { text: string }) {
  return toParagraphs(text).map((paragraph, i) => (
    <ProseParagraph key={i} text={paragraph} />
  ))
}
