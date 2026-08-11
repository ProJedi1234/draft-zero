import Link from "next/link"
import { Compass } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
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
    <div className="flex h-app items-center justify-center">
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
          <Link href="/" className={buttonVariants({ size: "sm" })}>
            Back to writing
          </Link>
        </EmptyContent>
      </Empty>
    </div>
  )
}
