// lib/services/schema.ts — Field schemas more than one resource shares.
// Isomorphic, like every schema.ts under lib/services.
import { z } from "zod"

import { isValidEntityId } from "@/lib/store/records"

/**
 * An id as the store accepts it. `message` is the sentence the old action
 * returned for this field, so a failed parse reads the same as it always has.
 */
export function entityId(message: string) {
  return z.string({ error: message }).refine(isValidEntityId, message)
}
