// lib/markdown.ts — Inline-only markdown for manuscript prose.
//
// Deliberately NOT a CommonMark implementation. The canvas renders a novel, so
// only the marks a novelist reaches for are honoured: emphasis, strong emphasis,
// and code. Block constructs (`# `, `- `, `> `, ``` ) are left as literal text —
// a model that emits a heading mid-chapter should look wrong on the page, not
// silently restyle the manuscript.
//
// Unterminated delimiters render literally, which is what makes this safe to run
// against a half-arrived stream: `**bol` is prose until its closer lands.

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }

const ESCAPABLE = "\\`*_"

function isWhitespace(char: string | undefined) {
  return char === undefined || /\s/.test(char)
}

/** Underscores are word characters in prose (`snake_case`, `re_read`). */
function isWord(char: string | undefined) {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char)
}

function runLength(source: string, index: number) {
  const char = source[index]
  let length = 0
  while (source[index + length] === char) length++
  return length
}

/**
 * First closing run of at least `size` `marker` characters that could end an
 * emphasis span — i.e. not preceded by whitespace, and for `_` not glued to a
 * word on its right. Returns -1 when the span never closes.
 */
function findCloser(
  source: string,
  from: number,
  marker: string,
  size: number
) {
  for (let i = from; i < source.length; i++) {
    if (source[i] === "\\") {
      i++
      continue
    }
    if (source[i] !== marker) continue

    const length = runLength(source, i)
    const closes =
      length >= size &&
      !isWhitespace(source[i - 1]) &&
      (marker !== "_" || !isWord(source[i + length]))
    if (closes) return i
    i += length - 1
  }
  return -1
}

function wrap(size: number, children: InlineNode[]): InlineNode {
  if (size === 1) return { type: "em", children }
  if (size === 2) return { type: "strong", children }
  return { type: "strong", children: [{ type: "em", children }] }
}

/** Parse one paragraph's worth of prose into inline nodes. */
export function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = []
  let text = ""

  const flush = () => {
    if (text === "") return
    nodes.push({ type: "text", value: text })
    text = ""
  }

  let i = 0
  while (i < source.length) {
    const char = source[i]

    if (char === "\\" && ESCAPABLE.includes(source[i + 1] ?? "")) {
      text += source[i + 1]
      i += 2
      continue
    }

    // Code spans win over emphasis, and their contents are literal — the one
    // place a writer can show the markers themselves.
    if (char === "`") {
      const end = source.indexOf("`", i + 1)
      if (end > i + 1) {
        flush()
        nodes.push({ type: "code", value: source.slice(i + 1, end) })
        i = end + 1
        continue
      }
      text += char
      i++
      continue
    }

    if (char === "*" || char === "_") {
      const size = Math.min(runLength(source, i), 3)
      const contentStart = i + size
      const opens =
        !isWhitespace(source[contentStart]) &&
        (char !== "_" || !isWord(source[i - 1]))
      const end = opens ? findCloser(source, contentStart, char, size) : -1

      if (end !== -1) {
        flush()
        nodes.push(wrap(size, parseInline(source.slice(contentStart, end))))
        // Only `size` characters of the closing run are consumed; any surplus
        // falls through as literal text.
        i = end + size
        continue
      }

      text += source.slice(i, contentStart)
      i = contentStart
      continue
    }

    text += char
    i++
  }

  flush()
  return nodes
}

/**
 * Split manuscript text into paragraphs. Blank-line separated, matching how the
 * composer and the models both break prose; single newlines stay inside a
 * paragraph and collapse to spaces the way HTML already does.
 */
export function toParagraphs(text: string): string[] {
  return text === "" ? [] : text.split("\n\n")
}
