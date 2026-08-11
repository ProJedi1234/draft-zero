"use client"

import * as React from "react"

/** Cmd/Ctrl+key → the delimiter it toggles around the selection. */
const BINDINGS: Record<string, string> = {
  b: "**",
  i: "*",
}

/**
 * Edits through `execCommand("insertText")` rather than by computing a new
 * string and pushing it through state. It is deprecated but it is the only way
 * to mutate a textarea that keeps the native undo stack intact — a writer who
 * hits Cmd+B and then Cmd+Z expects the bold to come off, not the paragraph they
 * typed before it. React still sees the resulting `input` event, so controlled
 * values stay in sync.
 */
function applyMark(el: HTMLTextAreaElement, marker: string) {
  const { selectionStart: start, selectionEnd: end, value } = el
  const width = marker.length
  const selected = value.slice(start, end)

  // Already wrapped? Toggle it off, so the shortcut is a switch and not an
  // accumulator of delimiters.
  const wrapped =
    value.slice(start - width, start) === marker &&
    value.slice(end, end + width) === marker

  if (wrapped) {
    el.setSelectionRange(start - width, end + width)
    document.execCommand("insertText", false, selected)
    el.setSelectionRange(start - width, end - width)
    return
  }

  document.execCommand("insertText", false, marker + selected + marker)
  // Land the caret inside the new delimiters, keeping any selection selected.
  el.setSelectionRange(start + width, end + width)
}

/**
 * Returns a keydown handler giving a plain markdown-source textarea the two
 * formatting shortcuts writers reach for by reflex. Everything else — the
 * markers themselves, escaping, code spans — is typed literally.
 */
export function useMarkdownShortcuts() {
  return React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!event.metaKey && !event.ctrlKey) return false
      if (event.altKey) return false

      const marker = BINDINGS[event.key.toLowerCase()]
      if (!marker) return false

      event.preventDefault()
      applyMark(event.currentTarget, marker)
      return true
    },
    []
  )
}
