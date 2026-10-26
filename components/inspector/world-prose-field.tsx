"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useAutosave } from "@/hooks/use-autosave"
import { useServerSyncedField } from "@/hooks/use-server-synced"
import type { ActionResult } from "@/lib/types"

export function WorldProseField({
  title,
  value,
  placeholder,
  maxLength,
  save,
  inputRef,
  disabled,
  trim = false,
  cancelRef,
  onSavingChange,
}: {
  title: string
  value: string
  placeholder: string
  maxLength: number
  save: (value: string) => Promise<ActionResult<unknown>>
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
  disabled?: boolean
  trim?: boolean
  cancelRef?: React.RefObject<(() => void) | null>
  onSavingChange?: (saving: boolean) => void
}) {
  const uid = React.useId()
  const ownRef = React.useRef<HTMLTextAreaElement>(null)
  const ref = inputRef ?? ownRef
  const edited = React.useRef(false)
  const [discarded, setDiscarded] = React.useState(false)
  const autosave = useAutosave(save)
  React.useEffect(() => {
    if (ref.current?.value === value && autosave.status !== "saving")
      edited.current = false
  }, [ref, value, autosave.status])
  React.useEffect(() => {
    onSavingChange?.(autosave.status === "saving")
  }, [autosave.status, onSavingChange])
  React.useEffect(() => {
    if (cancelRef) cancelRef.current = autosave.cancel
    return () => {
      if (cancelRef) cancelRef.current = null
    }
  }, [autosave.cancel, cancelRef])
  // A refused write remains a local edit until Retry or Discard, as on iOS.
  const field = useServerSyncedField(
    ref,
    value,
    autosave.status === "error" ? "saving" : autosave.status
  )
  function retry() {
    const text = ref.current?.value ?? value
    field.markWritten(trim ? text.trim() : text)
    autosave.schedule(text)
    autosave.flush()
  }
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={uid}>{title}</Label>
      <Textarea
        id={uid}
        ref={ref}
        defaultValue={value}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(event) => {
          edited.current = true
          setDiscarded(false)
          field.markWritten(
            trim ? event.target.value.trim() : event.target.value
          )
          autosave.schedule(event.target.value)
        }}
        onBlur={() => {
          autosave.flush()
          if (!edited.current) field.restore(value)
        }}
      />
      {autosave.status === "error" && !discarded && (
        <div className="flex items-center gap-2 text-xs" role="status">
          <span className="mr-auto text-muted-foreground">Not saved</span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              autosave.cancel()
              field.restore(value)
              edited.current = false
              setDiscarded(true)
            }}
          >
            Discard
          </Button>
          <Button size="xs" variant="outline" onClick={retry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  )
}
