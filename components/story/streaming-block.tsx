// components/story/streaming-block.tsx — In-flight prose.
//
// Typography is deliberately identical to a generated StoryEntryBlock (same
// wrapper padding, same serif spec, same paragraph rhythm) because both render
// through <ProseParagraph>, so when the persisted entry replaces this block
// there is no layout shift — only the hover action cluster appears.
//
// Inline markdown is parsed on every chunk. A half-arrived `**bol` has no closer
// yet, so it renders as literal text and snaps to bold when the closer lands;
// nothing flickers because an unterminated delimiter is never markup.

import { GenerationCaret } from "@/components/story/generation-caret"
import { ProseParagraph } from "@/components/story/prose"
import { toParagraphs } from "@/lib/markdown"
import type { GenerationStatus } from "@/hooks/use-generation"

/**
 * Deliberately NOT a live region: chunks land every ~24 ms and each one rewrites
 * the last paragraph, so `aria-live` here would re-announce the entire growing
 * passage dozens of times. StoryCanvas owns a small `role="status"` region that
 * announces the lifecycle instead; the finished passage is read as ordinary page
 * content once it lands as a StoryEntryBlock.
 */
export function StreamingBlock({
  text,
  pending,
  caret,
  status,
}: {
  text: string
  /** Before the first token: nothing to show but the caret. */
  pending: boolean
  /**
   * False once the passage is final and only waiting on its row. The block
   * stays mounted through that wait, so the caret has to stop signalling on its
   * own — otherwise finished prose reads as still being written.
   */
  caret: boolean
  /** Drives which state the caret shows: dots, hopping dots, or the bar. */
  status: GenerationStatus
}) {
  const paragraphs = toParagraphs(text)

  return (
    <div
      data-source="generated"
      data-streaming="true"
      data-pending={pending || undefined}
      className="relative -mx-4 px-4 py-3"
    >
      {paragraphs.length === 0 ? (
        <ProseParagraph text="">
          {caret && <GenerationCaret status={status} />}
        </ProseParagraph>
      ) : (
        paragraphs.map((paragraph, i) => (
          <ProseParagraph key={i} text={paragraph}>
            {caret && i === paragraphs.length - 1 && (
              <GenerationCaret status={status} />
            )}
          </ProseParagraph>
        ))
      )}
    </div>
  )
}
