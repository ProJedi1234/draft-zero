// components/inline-markdown.tsx — Inline markdown, rendered without opinions.
//
// Deliberately carries no typography of its own: it emits <strong>/<em>/<code>
// and nothing else, so it inherits whatever the calling surface has set. That is
// what lets the same renderer serve the serif manuscript and a 12px muted
// lorebook preview without either one leaking into the other.
//
// The only styling here is on <code>, and it is sized in `em` for the same
// reason — it has to sit correctly inside both.

import * as React from "react"

import { parseInline, type InlineNode } from "@/lib/markdown"

function renderNodes(nodes: InlineNode[]): React.ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return node.value
      case "code":
        return (
          <code
            key={i}
            className="rounded-none bg-muted px-1 py-0.5 font-mono text-[0.9em]"
          >
            {node.value}
          </code>
        )
      case "strong":
        return (
          <strong key={i} className="font-semibold">
            {renderNodes(node.children)}
          </strong>
        )
      case "em":
        return <em key={i}>{renderNodes(node.children)}</em>
    }
  })
}

/**
 * Renders one run of inline markdown. Emits a fragment, not a block — the caller
 * owns the element the text lives in, and with it the wrapping, clamping and
 * type spec.
 */
export function InlineMarkdown({ text }: { text: string }) {
  return renderNodes(parseInline(text))
}
