"use client"

import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { useInitialValue } from "@/hooks/use-initial-value"
import { cn } from "@/lib/utils"

function Input({
  className,
  type,
  defaultValue,
  ...props
}: React.ComponentProps<"input">) {
  // §4.2 fields hand a server value straight to `defaultValue`, and that prop
  // keeps changing as revalidation flows back. Nothing reads it after mount —
  // the DOM owns the value from then on — but Base UI's FieldControl warns
  // about the moving prop. Pinning it to the mount value keeps the behaviour
  // identical, drops the warning, and enforces "initialize once" in one place.
  const initialDefaultValue = useInitialValue(defaultValue)

  return (
    <InputPrimitive
      type={type}
      defaultValue={initialDefaultValue}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 border border-transparent border-b-input bg-transparent px-0 py-1 text-base transition-[color,border-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-b-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-b-destructive md:text-sm dark:aria-invalid:border-b-destructive/50",
        className
      )}
      {...props}
    />
  )
}

export { Input }
