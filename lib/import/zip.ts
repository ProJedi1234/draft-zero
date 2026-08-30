// lib/import/zip.ts — A minimal, dependency-free ZIP reader.
//
// AI Dungeon's backup export is the first format that arrives as an archive
// rather than a single JSON file, and it is the only reason this exists: the
// import path needs the same bytes readable in the browser (to preview a file
// before anything is written) and on the server (which re-reads them rather
// than trusting the client's parse), so the reader has to be isomorphic. That
// rules out node:zlib, and pulling a zip library in for two files inside one
// importer is more dependency than the job is worth.
//
// `DecompressionStream("deflate-raw")` is the whole trick — it is the one piece
// of this that would otherwise need a library, and it ships in every browser
// this app supports, in Node 18+, and in Bun. Everything else here is reading
// little-endian integers out of the archive's own directory.
//
// Scope, deliberately: enough of PKZIP to read a backup an app wrote minutes
// ago, and no more. Stored and deflated entries, no ZIP64, no encryption, no
// multi-disk. Each of those is refused by name rather than misread — a reader
// that quietly returns half an archive is worse than one that says it can't.
//
// Every entry is inflated against a BUDGET, because the size of an archive says
// nothing about the size of what is in it: DEFLATE tops out around 1032:1, so a
// 16MB archive can describe ~16GB of output and a caller that caps only its
// input has capped nothing. That is a decompression bomb, and it costs the
// sender a few hundred KB. See inflate.

/** Local file header. */
const LOCAL_HEADER_SIGNATURE = 0x04034b50
/** Central directory file header. */
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
/** End of central directory record. */
const EOCD_SIGNATURE = 0x06054b50
/** ZIP64 end of central directory locator — recognised only to refuse it. */
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50

/** The EOCD is 22 bytes plus a comment of at most 65535. */
const MAX_EOCD_SCAN = 22 + 0xffff

/** Sentinel written into a 16- or 32-bit field that ZIP64 has moved elsewhere. */
const U16_MAX = 0xffff
const U32_MAX = 0xffffffff

const STORED = 0
const DEFLATED = 8

/**
 * How many inflated bytes one archive may produce in total, unless the caller
 * says otherwise.
 *
 * A TOTAL rather than a per-entry cap: the bomb does not care how many entries
 * it is spread across, and a per-entry limit of N with a hundred entries is a
 * limit of 100N. Reading the same entry twice is charged twice, which is right
 * for a budget measuring work done rather than bytes held.
 *
 * 128MB is chosen against the compressed ceilings callers actually use (~16MB
 * for a backup) and the ratio real files hit — the AI Dungeon sample inflates
 * 4.8:1, so 8:1 is generous headroom for a legitimate archive at that size —
 * while cutting the 1032:1 worst case by two orders of magnitude. A flat number
 * rather than a ratio test on purpose: a ratio tight enough to matter also
 * rejects the very repetitive JSON these archives legitimately contain.
 */
export const DEFAULT_MAX_INFLATED_BYTES = 128 * 1024 * 1024

/** One file in the archive, still compressed. */
interface CentralEntry {
  name: string
  method: number
  compressedSize: number
  /**
   * What the directory CLAIMS the entry inflates to. Free to read and worth a
   * pre-check, but never trusted on its own: the field is written by whoever
   * built the archive, so a bomb simply lies about it. The streaming budget in
   * `inflate` is the check that actually holds.
   */
  uncompressedSize: number
  localHeaderOffset: number
}

export class ZipError extends Error {}

/**
 * The archive's file names, in central-directory order, mapped to a reader for
 * their bytes. A map rather than a list of decompressed entries because a
 * backup carries one metadata file and N action parts, and the caller decides
 * which of those it wants before paying to inflate any of them — an archive of
 * a long story is mostly action parts, and a preview that inflated all of them
 * to read the title would stall the picker on the writer's phone.
 */
export interface ZipArchive {
  /** Every entry name, in the order the archive lists them. */
  names: string[]
  /** Inflates one entry. Rejects on an unreadable or absent one. */
  read(name: string): Promise<Uint8Array>
  /** Inflates one entry and decodes it as UTF-8. */
  readText(name: string): Promise<string>
}

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true)
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true)
}

/**
 * The EOCD offset, found by scanning backwards for its signature.
 *
 * Backwards, and not by assuming the record is the last 22 bytes, because the
 * archive comment sits after it and is allowed to be up to 64KB of anything —
 * including, in principle, the signature itself. Scanning from the end takes
 * the LAST match, which is the real record whenever a comment merely quotes it.
 */
function findEocd(view: DataView): number {
  const from = Math.max(0, view.byteLength - MAX_EOCD_SCAN)
  for (let offset = view.byteLength - 22; offset >= from; offset -= 1) {
    if (u32(view, offset) === EOCD_SIGNATURE) return offset
  }
  return -1
}

/**
 * Reads the central directory — the archive's own index, which is what makes a
 * zip readable without scanning it end to end.
 */
function readCentralDirectory(view: DataView): CentralEntry[] {
  const eocd = findEocd(view)
  if (eocd < 0) {
    throw new ZipError("That file isn't a zip archive.")
  }

  // A spanned archive has entries this reader would never find, so it is
  // refused rather than read as an empty one.
  if (u16(view, eocd + 4) !== 0 || u16(view, eocd + 6) !== 0) {
    throw new ZipError("That zip is split across multiple files.")
  }

  const count = u16(view, eocd + 10)
  const directoryOffset = u32(view, eocd + 16)

  // Either sentinel means the real values live in a ZIP64 record. Nothing AI
  // Dungeon exports comes close to 65535 files or a 4GB directory, so this is
  // a refusal rather than a second parser — but it must be a refusal, because
  // reading the sentinel as a literal count walks straight off the buffer.
  if (
    count === U16_MAX ||
    directoryOffset === U32_MAX ||
    (eocd >= 20 && u32(view, eocd - 20) === ZIP64_LOCATOR_SIGNATURE)
  ) {
    throw new ZipError("That zip uses ZIP64, which this reader can't open.")
  }

  const entries: CentralEntry[] = []
  let offset = directoryOffset
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > view.byteLength) {
      throw new ZipError("That zip's directory is truncated.")
    }
    if (u32(view, offset) !== CENTRAL_HEADER_SIGNATURE) {
      throw new ZipError("That zip's directory is corrupt.")
    }
    const flags = u16(view, offset + 8)
    // Bit 0 is the encryption flag. An encrypted entry inflates to garbage
    // rather than failing, which is exactly the quiet wrong answer to avoid.
    if ((flags & 0x1) !== 0) {
      throw new ZipError("That zip is encrypted.")
    }
    const nameLength = u16(view, offset + 28)
    const extraLength = u16(view, offset + 30)
    const commentLength = u16(view, offset + 32)
    // Checked before the read, not after: an out-of-range length makes the
    // Uint8Array constructor throw RangeError, which escapes as something other
    // than a ZipError and loses the "refuse by name" discipline the rest of
    // this reader keeps.
    if (offset + 46 + nameLength > view.byteLength) {
      throw new ZipError("That zip's directory is truncated.")
    }
    const name = new TextDecoder().decode(
      new Uint8Array(view.buffer, view.byteOffset + offset + 46, nameLength)
    )
    entries.push({
      name,
      method: u16(view, offset + 10),
      compressedSize: u32(view, offset + 20),
      uncompressedSize: u32(view, offset + 24),
      localHeaderOffset: u32(view, offset + 42),
    })
    offset += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

/**
 * The compressed bytes of one entry.
 *
 * The name and extra fields are re-read from the LOCAL header rather than
 * reused from the central directory: the two are allowed to differ in length,
 * and taking the central copy's lengths as the local ones puts the data slice
 * at the wrong offset — a bug that shows up only on archives whose writer
 * padded one of the two, which is to say rarely and unreproducibly.
 */
function sliceEntry(
  bytes: Uint8Array,
  view: DataView,
  entry: CentralEntry
): Uint8Array {
  const start = entry.localHeaderOffset
  if (
    start + 30 > view.byteLength ||
    u32(view, start) !== LOCAL_HEADER_SIGNATURE
  ) {
    throw new ZipError(`"${entry.name}" isn't where the zip says it is.`)
  }
  const dataStart = start + 30 + u16(view, start + 26) + u16(view, start + 28)
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > bytes.length) {
    throw new ZipError(`"${entry.name}" is truncated.`)
  }
  return bytes.subarray(dataStart, dataEnd)
}

/**
 * The archive's remaining inflate allowance, shared by every entry read through
 * one `openZip`. An object rather than a number so the count survives across
 * the reads that spend it.
 */
interface Budget {
  spend(bytes: number): void
  remaining(): number
}

function makeBudget(limit: number): Budget {
  let left = limit
  return {
    spend(bytes) {
      left -= bytes
      if (left < 0) {
        throw new ZipError(
          "That zip expands to far more than it should — it looks like a decompression bomb."
        )
      }
    },
    remaining: () => left,
  }
}

/**
 * Inflates one entry, refusing to produce more than `budget` allows.
 *
 * Read in CHUNKS against a running total, rather than with
 * `new Response(stream).arrayBuffer()` as this did first. That call grants a
 * decompression bomb its whole wish: it buffers the entire output before anyone
 * can look at how much output there is, so the memory is already spent by the
 * time a size check could run. Counting as the chunks arrive abandons a bomb a
 * few hundred KB in, and `cancel()` stops the decompressor rather than leaving
 * it running to fill a buffer nobody will read.
 */
async function inflate(data: Uint8Array, budget: Budget): Promise<Uint8Array> {
  // "deflate-raw", not "deflate": zip entries carry a bare deflate stream with
  // no zlib header, and the zlib decoder rejects them outright.
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))

  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      budget.spend(value.length)
      chunks.push(value)
    }
  } finally {
    // Unconditional. On the budget path it stops a decompressor that would
    // otherwise keep inflating; on the success path the stream is already done
    // and this is a no-op.
    await reader.cancel().catch(() => {})
  }

  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/**
 * Opens an archive. Reads only the directory up front, so opening a backup of a
 * thousand-passage story costs the same as opening an empty one.
 */
export function openZip(
  input: ArrayBuffer | Uint8Array,
  options: { maxInflatedBytes?: number } = {}
): ZipArchive {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries = readCentralDirectory(view)
  const byName = new Map(entries.map((entry) => [entry.name, entry]))
  const budget = makeBudget(
    options.maxInflatedBytes ?? DEFAULT_MAX_INFLATED_BYTES
  )

  async function read(name: string): Promise<Uint8Array> {
    const entry = byName.get(name)
    if (!entry) throw new ZipError(`That zip has no "${name}" in it.`)
    const data = sliceEntry(bytes, view, entry)
    if (entry.method === STORED) {
      // Stored entries spend the budget too. They cannot be a bomb — the bytes
      // are already in the archive — but they are still output, and a budget
      // that only counted deflated entries would hand a caller more than it
      // agreed to hold.
      budget.spend(data.length)
      return data
    }
    if (entry.method === DEFLATED) {
      // Free pre-check: refuse before starting a decompressor at all when the
      // directory itself admits the entry is too big. An honest oversized
      // archive is rejected here; a bomb lies about this field and is caught by
      // the streaming budget instead.
      if (entry.uncompressedSize > budget.remaining()) {
        throw new ZipError(
          `"${entry.name}" expands to more than this reader will hold.`
        )
      }
      try {
        return await inflate(data, budget)
      } catch (error) {
        // A budget refusal is this reader's own verdict and says something the
        // caller can act on. The blanket catch reported it as "couldn't be
        // decompressed", which turns a bomb into a corrupt file.
        if (error instanceof ZipError) throw error
        throw new ZipError(`"${entry.name}" couldn't be decompressed.`)
      }
    }
    throw new ZipError(
      `"${entry.name}" uses a compression this reader can't open.`
    )
  }

  return {
    names: entries.map((entry) => entry.name),
    read,
    async readText(name: string) {
      return new TextDecoder().decode(await read(name))
    },
  }
}
