"use client"

import * as React from "react"

import { useInitialValue } from "@/hooks/use-initial-value"
import { cn } from "@/lib/utils"

function Textarea({
  className,
  defaultValue,
  ...props
}: React.ComponentProps<"textarea">) {
  // Same rule as Input: §4.2 textareas are seeded once and own their value
  // afterwards, so a moving `defaultValue` prop is noise.
  const initialDefaultValue = useInitialValue(defaultValue)

  return (
    // iOS classifies a text control with no form owner as loose contact input:
    // it raises the AutoFill Contact bar and suppresses autocorrect, which is
    // how a field of prose ends up correcting nothing. A form owner is what
    // stops that — verified on device, where a bare textarea carrying no
    // attributes at all was offered contact autofill just the same, and no
    // wording of the label or `autocomplete` changed it.
    //
    // `display: contents` keeps the wrapper out of layout, so a textarea still
    // sits in its parent's flex or grid flow exactly as before; form ownership
    // is a DOM relationship, not a rendered one, so it counts regardless.
    //
    // Nothing submits — every textarea in this app is saved by its own
    // handlers — so the guard below is only there for the return key. For the
    // same reason a <Textarea> must not be placed inside a <form>: the two
    // would nest.
    <form className="contents" onSubmit={(event) => event.preventDefault()}>
      <textarea
        defaultValue={initialDefaultValue}
        data-slot="textarea"
        // Every textarea in this app holds prose, so the writing keyboard is the
        // default rather than something each caller rediscovers on a phone.
        // `{...props}` still wins, for the fields that want none of it.
        autoCorrect="on"
        autoCapitalize="sentences"
        spellCheck
        className={cn(
          "flex field-sizing-content min-h-16 w-full resize-none rounded-none border border-transparent border-b-input bg-transparent px-0 py-3 text-base transition-[color,border-color] outline-none placeholder:text-muted-foreground focus-visible:border-b-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-b-destructive md:text-sm dark:aria-invalid:border-b-destructive/50",
          className
        )}
        {...props}
      />
    </form>
  )
}

export { Textarea }
