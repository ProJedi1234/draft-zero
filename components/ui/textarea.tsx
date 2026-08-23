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
  )
}

export { Textarea }
