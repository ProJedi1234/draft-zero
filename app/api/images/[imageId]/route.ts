// GET /api/images/[imageId] — the bytes behind a story_images row.
//
// A route rather than /public: illustrations are user data written at runtime,
// and Next only serves /public as it stood at build time. The row is consulted
// first because it holds the media type, which is what tells the store which
// file on disk this id became.
import { getStoryImageMedia } from "@/lib/db/queries"
import { readImage } from "@/lib/images/store"

// Node, explicitly: the store reads the filesystem, which an edge isolate has
// no access to at all.
export const runtime = "nodejs"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ imageId: string }> }
): Promise<Response> {
  const { imageId } = await params

  const media = await getStoryImageMedia(imageId)
  if (!media) return new Response(null, { status: 404 })

  const bytes = await readImage(imageId, media.mediaType)
  if (!bytes) return new Response(null, { status: 404 })

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": media.mediaType,
      // Immutable for a year: an id names one set of bytes for its whole life —
      // retrying an illustration mints a NEW row rather than rewriting this
      // one, which is what makes caching safe here at all.
      "Cache-Control": "public, max-age=31536000, immutable",
      // SVG is script-capable, and these bytes came from a generative model.
      // The mock's output is ours, but a real provider's is not, and an image
      // route that can execute script in the app's origin is a hole regardless
      // of who is filling it today.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  })
}
