// lib/images/store.ts — Where illustration bytes actually live. Server-only.
//
// On disk or in an S3 bucket, not in Postgres: getStory loads a whole
// manuscript on every request, and a base64 column would put a megabyte per
// illustration into that read for the sake of data nothing ever queries. The
// row holds the identity, the blob holds the pixels, and lib/db/schema.ts's
// story_images is small enough to stay cheap however many pictures a story
// accumulates. lib/images/blob-store.ts chooses between disk and bucket.
//
// Deleting a row deliberately does NOT delete its blob. Illustration delete is
// a soft delete that undo can reverse, and a blob removed on the way out would
// make that undo restore a row pointing at nothing.
import "server-only"

import { readBlob, resolveImageBackend, writeBlob } from "./blob-store"

/** Writes an image's bytes. Returns nothing: the row's id + mediaType locate it. */
export async function writeImage(
  id: string,
  mediaType: string,
  b64: string
): Promise<void> {
  await writeBlob(
    resolveImageBackend(),
    id,
    mediaType,
    Buffer.from(b64, "base64")
  )
}

/**
 * An image's bytes, or null when the blob is gone.
 *
 * Null rather than a throw because a missing blob is a recoverable state the
 * route turns into a 404 — a story whose blobs were cleaned up should show
 * broken pictures, not fail to load. A bucket that cannot be reached still
 * throws, so the route answers 500 instead of pretending the picture is gone.
 */
export async function readImage(
  id: string,
  mediaType: string
): Promise<Buffer | null> {
  return readBlob(resolveImageBackend(), id, mediaType)
}
