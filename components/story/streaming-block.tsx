// components/story/streaming-block.tsx — In-flight prose.
//
// Typography is deliberately identical to a generated StoryEntryBlock (same
// wrapper padding, same serif spec, same paragraph rhythm) so that when the
// persisted entry replaces this block there is no layout shift — only the
// hover action cluster appears.

const PARAGRAPH_CLASS =
  "font-serif text-[1.0625rem] leading-8 text-foreground [&:not(:first-child)]:mt-5"

function Caret() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-[1.05em] w-0.5 translate-y-[0.15em] animate-pulse bg-primary/60 align-baseline"
    />
  )
}

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
}: {
  text: string
  pending: boolean
}) {
  const paragraphs = text === "" ? [] : text.split("\n\n")

  return (
    <div
      data-source="generated"
      data-streaming="true"
      data-pending={pending || undefined}
      className="relative -mx-4 px-4 py-3"
    >
      {paragraphs.length === 0 ? (
        <p className={PARAGRAPH_CLASS}>
          <Caret />
        </p>
      ) : (
        paragraphs.map((paragraph, i) => (
          <p key={i} className={PARAGRAPH_CLASS}>
            {paragraph}
            {i === paragraphs.length - 1 && <Caret />}
          </p>
        ))
      )}
    </div>
  )
}
