import Link from "next/link"
import { Compass } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

export default function NotFound() {
  return (
    <div className="flex h-svh items-center justify-center">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Compass />
          </EmptyMedia>
          <EmptyTitle>Off the map</EmptyTitle>
          <EmptyDescription>
            This page doesn&apos;t exist in any of your stories.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" render={<Link href="/" />}>
            Back to writing
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
