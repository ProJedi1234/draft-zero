// GET /api/gallery — every illustration slot in the library, newest first, as
// the gallery page's photo wall reads them.
import { listGalleryImages } from "@/lib/db/queries"

export const runtime = "nodejs"

export async function GET(): Promise<Response> {
  return Response.json(
    { images: await listGalleryImages() },
    { headers: { "cache-control": "no-store" } }
  )
}
