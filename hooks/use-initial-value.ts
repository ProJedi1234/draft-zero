"use client"

import * as React from "react"

/**
 * The value this component was first rendered with, ignoring every later
 * change. Used to pin `defaultValue` on uncontrolled-after-mount fields (§4.2),
 * whose server prop keeps changing under them as revalidation flows back.
 */
export function useInitialValue<T>(value: T): T {
  // State, not a ref: the initializer runs once and the value is read during
  // render, which is exactly what state is for (and what the refs lint wants).
  const [initial] = React.useState(value)
  return initial
}
