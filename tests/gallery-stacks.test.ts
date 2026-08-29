// tests/gallery-stacks.test.ts — What the photo wall shows about retries.
//
// Two claims the gallery makes, both of which the manuscript already made and
// the wall used to contradict: a retried picture is ONE tile, and every draw
// behind it is still reachable. Pinned here rather than in the component
// because the whole rule is a row-set → tile-set function.

import { describe, expect, test } from "bun:test"

import { toGalleryImages, type GalleryImageRow } from "@/lib/db/mappers"

function row(over: Partial<GalleryImageRow> = {}): GalleryImageRow {
  return {
    id: "img-1",
    prompt: "A river at dusk.",
    aspectRatio: "16:9",
    mediaType: "image/png",
    modelId: "~openai/gpt-image-1",
    seed: 7,
    createdAt: "2026-08-20T10:00:00Z",
    imageGroupId: "slot-1",
    isActive: true,
    storyId: "story-1",
    storyTitle: "The Green River",
    tintHue: 140,
    tintStrength: 0.05,
    ...over,
  }
}

describe("toGalleryImages", () => {
  test("a picture never retried is one tile holding one take", () => {
    const [image] = toGalleryImages([row()])
    expect(image.takes).toHaveLength(1)
    expect(image.imageIndex).toBe(0)
    expect(image.id).toBe("img-1")
  })

  test("a retried picture is one tile, not one per draw", () => {
    const images = toGalleryImages([
      row({ id: "img-1", isActive: false }),
      row({ id: "img-2", isActive: false }),
      row({ id: "img-3", isActive: true }),
    ])
    expect(images).toHaveLength(1)
    expect(images[0].takes.map((t) => t.id)).toEqual([
      "img-1",
      "img-2",
      "img-3",
    ])
  })

  test("the tile wears the active take, wherever in the slot it sits", () => {
    const [image] = toGalleryImages([
      row({ id: "img-1", isActive: false, prompt: "First try." }),
      row({ id: "img-2", isActive: true, prompt: "Second try." }),
      row({ id: "img-3", isActive: false, prompt: "Third try." }),
    ])
    expect(image.id).toBe("img-2")
    expect(image.prompt).toBe("Second try.")
    expect(image.imageIndex).toBe(1)
  })

  test("slots order by their first take, so a retry cannot jump the queue", () => {
    const images = toGalleryImages([
      row({
        id: "old-1",
        imageGroupId: "slot-old",
        isActive: false,
        createdAt: "2026-08-01T00:00:00Z",
      }),
      row({
        id: "new-1",
        imageGroupId: "slot-new",
        createdAt: "2026-08-10T00:00:00Z",
      }),
      // The old picture, retried today: newer than anything else on the wall,
      // and it must still sit where the old picture sat.
      row({
        id: "old-2",
        imageGroupId: "slot-old",
        isActive: true,
        createdAt: "2026-08-29T00:00:00Z",
      }),
    ])
    expect(images.map((i) => i.imageGroupId)).toEqual(["slot-new", "slot-old"])
  })

  test("same-instant pictures hold a stable order rather than swapping", () => {
    const rows = [
      row({ id: "aaa", imageGroupId: "slot-a" }),
      row({ id: "bbb", imageGroupId: "slot-b" }),
    ]
    expect(toGalleryImages(rows).map((i) => i.id)).toEqual(["bbb", "aaa"])
    expect(toGalleryImages([...rows].reverse()).map((i) => i.id)).toEqual([
      "bbb",
      "aaa",
    ])
  })

  test("a slot with no active take is dropped, not guessed at", () => {
    expect(
      toGalleryImages([
        row({ id: "img-1", isActive: false }),
        row({ id: "img-2", isActive: false }),
      ])
    ).toEqual([])
  })
})
