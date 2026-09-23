// tests/image-blob-store.garage.test.ts — The S3 backend against a real Garage.
//
// The unit tests stub fetch, so they cannot catch a signature Garage rejects.
// This file can. It runs when DRAFT_ZERO_TEST_GARAGE_ENDPOINT is set, which CI
// does after starting compose.s3.yaml's Garage; locally:
//
//   docker compose -f compose.yaml -f compose.s3.yaml up -d --wait garage
//   DRAFT_ZERO_TEST_GARAGE_ENDPOINT=http://127.0.0.1:3900 bun test garage

import { describe, expect, test } from "bun:test"

import { readBlob, writeBlob, type ImageBackend } from "@/lib/images/blob-store"

const endpoint = process.env.DRAFT_ZERO_TEST_GARAGE_ENDPOINT

// Must match compose.s3.yaml; a drift fails every test below rather than
// skipping them.
const GARAGE: ImageBackend = {
  kind: "s3",
  endpoint: endpoint ?? "",
  bucket: "draft-zero-images-dev",
  region: "garage",
  accessKeyId: "GK3f4eb4bad19b83d4a0eae4ba",
  secretAccessKey:
    "5e1044ae375a0c9ae8e18091eabb9f0374ccfad3816c4f4cf354f1c8f992e828",
}

describe.skipIf(!endpoint)("S3 backend against Garage", () => {
  test("a written picture reads back byte for byte", async () => {
    const id = crypto.randomUUID()
    const bytes = crypto.getRandomValues(new Uint8Array(4096))

    await writeBlob(GARAGE, id, "image/png", bytes)
    const back = await readBlob(GARAGE, id, "image/png")

    expect(back).not.toBeNull()
    expect(new Uint8Array(back!)).toEqual(bytes)
  })

  test("a missing picture is null", async () => {
    expect(await readBlob(GARAGE, crypto.randomUUID(), "image/png")).toBeNull()
  })

  test("a rejected signature throws instead of reading as missing", async () => {
    const wrongKey = { ...GARAGE, secretAccessKey: "0".repeat(64) }
    await expect(
      readBlob(wrongKey, crypto.randomUUID(), "image/png")
    ).rejects.toThrow(/S3 GET/)
  })
})
