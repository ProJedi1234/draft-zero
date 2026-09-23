// POST /api/import/backup — import an AI Dungeon backup as a new story. The
// body is the raw `.zip` bytes, not JSON: base64 would inflate an archive the
// cap already measures in bytes, and the zip is binary to begin with.
import { contextOf, refuse, respond } from "@/lib/api/respond"
import { MAX_BACKUP_BYTES } from "@/lib/import/aidungeon-backup"
import { importAiDungeonBackup } from "@/lib/services/import"
import {
  BACKUP_TOO_LARGE,
  backupImportOutput,
} from "@/lib/services/import.schema"
import { fail } from "@/lib/services/result"

export const runtime = "nodejs"

export async function POST(request: Request): Promise<Response> {
  // Refuse on the declared length before buffering, as the action refuses on
  // `File.size` before reading; the service re-checks the bytes that arrived.
  const declared = Number(request.headers.get("content-length"))
  if (declared > MAX_BACKUP_BYTES) {
    return refuse(fail("invalid", BACKUP_TOO_LARGE))
  }
  const bytes = await request.arrayBuffer()
  const file = new File([bytes], "backup.zip", { type: "application/zip" })
  const result = await importAiDungeonBackup({ file }, contextOf(request))
  return respond(backupImportOutput, result)
}
