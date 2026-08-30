// tests/helpers/zip.ts — Builds a zip archive in memory, for the tests that
// read one.
//
// A reader for a binary format is only as good as the archives you can point it
// at, and the archives that matter most are the ones no tool will write for
// you: an encrypted entry, a ZIP64 sentinel, a trailing comment that quotes the
// end-of-directory signature. `assemble` takes the malformed cases directly so
// each refusal is tested rather than assumed.
//
// `buildZip` writes STORED entries, which is all most callers need.
// `buildZipDeflated` covers the inflate path.

const LOCAL_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
const EOCD_SIGNATURE = 0x06054b50

/** The standard CRC-32, which zip stores per entry. */
function crc32(bytes: Uint8Array): number {
  let crc = ~0
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return ~crc >>> 0
}

/** One file, as name → contents. Contents are encoded UTF-8. */
export type ZipFiles = Record<string, string>

/** How one entry is stored. */
const STORED = 0
const DEFLATED = 8

export function buildZip(files: ZipFiles): Uint8Array {
  return assemble(
    Object.entries(files).map(([name, contents]) => ({
      name,
      raw: new TextEncoder().encode(contents),
      data: new TextEncoder().encode(contents),
      method: STORED,
    }))
  )
}

/**
 * The same archive, deflated. Async because `CompressionStream` is — which is
 * also why this is a separate function rather than an option: a sync builder
 * that half the callers must await is worse than two builders.
 */
export async function buildZipDeflated(files: ZipFiles): Promise<Uint8Array> {
  const entries = []
  for (const [name, contents] of Object.entries(files)) {
    const raw = new TextEncoder().encode(contents)
    const stream = new Blob([raw as BlobPart])
      .stream()
      .pipeThrough(new CompressionStream("deflate-raw"))
    entries.push({
      name,
      raw,
      data: new Uint8Array(await new Response(stream).arrayBuffer()),
      method: DEFLATED,
    })
  }
  return assemble(entries)
}

interface BuiltEntry {
  name: string
  /** Uncompressed bytes, for the size and CRC fields. */
  raw: Uint8Array
  /** What actually goes in the file, compressed or not. */
  data: Uint8Array
  method: number
}

/**
 * Options for archives that are deliberately malformed, so the reader's
 * refusals can be tested rather than assumed.
 */
export interface AssembleOptions {
  /** Set the encryption flag on every entry. */
  encrypted?: boolean
  /** Write the ZIP64 sentinel into the EOCD's entry count. */
  zip64?: boolean
  /** Bytes appended after the EOCD, as an archive comment would be. */
  comment?: string
}

export function assemble(
  entries: BuiltEntry[],
  options: AssembleOptions = {}
): Uint8Array {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  const flags = options.encrypted ? 0x1 : 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const sum = crc32(entry.raw)

    const local = new Uint8Array(30 + nameBytes.length + entry.data.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, LOCAL_HEADER_SIGNATURE, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, flags, true)
    localView.setUint16(8, entry.method, true)
    localView.setUint32(14, sum, true)
    localView.setUint32(18, entry.data.length, true)
    localView.setUint32(22, entry.raw.length, true)
    localView.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    local.set(entry.data, 30 + nameBytes.length)
    locals.push(local)

    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, CENTRAL_HEADER_SIGNATURE, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, flags, true)
    centralView.setUint16(10, entry.method, true)
    centralView.setUint32(16, sum, true)
    centralView.setUint32(20, entry.data.length, true)
    centralView.setUint32(24, entry.raw.length, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centrals.push(central)

    offset += local.length
  }

  const directorySize = centrals.reduce((sum, entry) => sum + entry.length, 0)
  const comment = encoder.encode(options.comment ?? "")
  const eocd = new Uint8Array(22 + comment.length)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, EOCD_SIGNATURE, true)
  eocdView.setUint16(8, centrals.length, true)
  // 0xffff is the sentinel meaning "the real count lives in a ZIP64 record".
  eocdView.setUint16(10, options.zip64 ? 0xffff : centrals.length, true)
  eocdView.setUint32(12, directorySize, true)
  eocdView.setUint32(16, offset, true)
  eocdView.setUint16(20, comment.length, true)
  eocd.set(comment, 22)

  const parts = [...locals, ...centrals, eocd]
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
