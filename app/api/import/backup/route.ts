// POST /api/import/backup — import an AI Dungeon backup as a new story. The
// body is the raw `.zip` bytes, not JSON: base64 would inflate an archive the
// cap already measures in bytes, and the zip is binary to begin with.
import { contextOf, readBytes, refuse, respond } from "@/lib/api/respond"
import { MAX_BACKUP_BYTES } from "@/lib/import/aidungeon-backup"
import { importAiDungeonBackup } from "@/lib/services/import"
import {
  BACKUP_TOO_LARGE,
  backupImportOutput,
} from "@/lib/services/import.schema"

export const runtime = "nodejs"

export async function POST(request: Request): Promise<Response> {
  // Refuse before buffering past the cap, as the action refused on `File.size`
  // before reading; the service re-checks the bytes that arrived.
  const bytes = await readBytes(request, MAX_BACKUP_BYTES, BACKUP_TOO_LARGE)
  if (!bytes.ok) return refuse(bytes)
  const file = new File([bytes.data], "backup.zip", { type: "application/zip" })
  const result = await importAiDungeonBackup({ file }, contextOf(request))
  return respond(backupImportOutput, result)
}
