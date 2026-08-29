// lib/images/store.ts — Where illustration bytes actually live. Server-only.
//
// On disk, not in Postgres: getStory loads a whole manuscript on every request,
// and a base64 column would put a megabyte per illustration into that read for
// the sake of data nothing ever queries. The row holds the identity, the file
// holds the pixels, and lib/db/schema.ts's story_images is small enough to stay
// cheap however many pictures a story accumulates.
//
// Deleting a row deliberately does NOT delete its file. Illustration delete is
// a soft delete that undo can reverse, and a file removed on the way out would
// make that undo restore a row pointing at nothing.
import "server-only"

import { mkdir, readFile, writeFile } from "node:fs/promises"

import { imageFilePath, IMAGE_DIR } from "./blob-path"

/** Writes an image's bytes. Returns nothing: the row's id + mediaType locate it. */
export async function writeImage(
  id: string,
  mediaType: string,
  b64: string
): Promise<void> {
  await mkdir(IMAGE_DIR, { recursive: true })
  await writeFile(imageFilePath(id, mediaType), Buffer.from(b64, "base64"))
}

/**
 * An image's bytes, or null when the file is gone.
 *
 * Null rather than a throw because a missing file is a recoverable state the
 * route turns into a 404 — a story whose blobs were cleaned up should show
 * broken pictures, not fail to load.
 */
export async function readImage(
  id: string,
  mediaType: string
): Promise<Buffer | null> {
  try {
    return await readFile(imageFilePath(id, mediaType))
  } catch {
    return null
  }
}
