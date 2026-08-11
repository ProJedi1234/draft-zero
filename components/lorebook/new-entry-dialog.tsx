"use client"

import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"

import { LorebookEntryEditor } from "@/components/lorebook/lorebook-entry-editor"

export function NewEntryDialog() {
  return (
    <Dialog>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus data-icon="inline-start" />
        New entry
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New lorebook entry</DialogTitle>
          <DialogDescription>
            Define a person, place, or idea the model should remember.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60svh] pr-3">
          <LorebookEntryEditor layout="dialog" />
        </ScrollArea>
        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            }
          />
          <Button size="sm">Create entry</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
