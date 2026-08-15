"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  THINKING_LEVEL_LABELS,
  type ModelReasoning,
  type ThinkingLevel,
} from "@/lib/types"

/**
 * Thinking level for one model, shared by the inspector and the settings page.
 * Renders nothing when the model can't reason — the setting would be a lie.
 *
 * "off" is always offered: on a mandatory-reasoning model it means "don't ask
 * for a level", which the provider answers with its own default.
 */
export function ThinkingSelect({
  id,
  reasoning,
  value,
  onValueChange,
  onOpenChange,
  disabled,
}: {
  id?: string
  /** The selected model's reasoning support; null hides the control. */
  reasoning: ModelReasoning | null
  value: ThinkingLevel
  onValueChange: (thinking: ThinkingLevel) => void
  /** Reported so a caller can hold off server-driven changes while this is open. */
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
}) {
  if (!reasoning) return null
  const levels: ThinkingLevel[] = ["off", ...reasoning.efforts]

  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange(next as ThinkingLevel)}
      onOpenChange={onOpenChange}
      disabled={disabled}
      items={levels.map((level) => ({
        value: level,
        label: THINKING_LEVEL_LABELS[level],
      }))}
    >
      <SelectTrigger id={id} size="sm" className="w-full">
        <span className="text-muted-foreground">Thinking</span>
        <SelectValue className="flex-none" />
      </SelectTrigger>
      <SelectContent>
        {levels.map((level) => (
          <SelectItem key={level} value={level}>
            {THINKING_LEVEL_LABELS[level]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * The level to keep when the model changes: the current one if the new model
 * offers it, otherwise off — never a level that would be rejected on send.
 */
export function levelForModel(
  reasoning: ModelReasoning | null | undefined,
  current: ThinkingLevel
): ThinkingLevel {
  if (current === "off" || !reasoning) return "off"
  return reasoning.efforts.includes(current) ? current : "off"
}
