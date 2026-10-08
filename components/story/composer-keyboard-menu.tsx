"use client"

import { Keyboard } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { MobileReturn } from "@/hooks/use-composer-return"

export function ComposerKeyboardMenu({
  preference,
  onPreferenceChange,
  insertLineBreak,
  disabled,
}: {
  preference: MobileReturn
  onPreferenceChange: (value: MobileReturn) => void
  insertLineBreak: () => void
  disabled: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Composer keyboard options"
          />
        }
      >
        <Keyboard />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" finalFocus={false}>
        <DropdownMenuItem
          disabled={disabled}
          onClick={() => requestAnimationFrame(insertLineBreak)}
        >
          Insert line break
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Mobile Return key · this device</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preference}
            onValueChange={(value) => onPreferenceChange(value as MobileReturn)}
          >
            <DropdownMenuRadioItem value="send">Send</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="newline">
              Insert new line
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
