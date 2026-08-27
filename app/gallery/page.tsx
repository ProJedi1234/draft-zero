import type { Metadata } from "next"

import { PhotoWall } from "@/components/gallery/photo-wall"
import { listGalleryImages } from "@/lib/db/queries"

export const metadata: Metadata = {
  title: "Gallery",
}

/**
 * Every illustration in the library on one wall. The page is a thin data
 * fetch: the wall owns its own chrome (header, grouping, lightbox) because
 * grouping is client state and the header holds its toggle.
 */
export default async function GalleryPage() {
  const images = await listGalleryImages()
  return <PhotoWall images={images} />
}
