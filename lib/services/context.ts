// lib/services/context.ts — Who is calling a service. Kept out of the input
// schemas because it describes the transport, not the request.
import type { ServiceResult } from "@/lib/services/result"

export interface ServiceContext {
  /**
   * The acting device's sync id, stamped on the bus events a write publishes
   * so that device can ignore its own echo. Null for callers with no sync
   * channel of their own (MCP, scripts).
   */
  origin: string | null
}

export const NO_ORIGIN: ServiceContext = { origin: null }

/**
 * The (raw, ctx) contract every service meets. A service that never reads ctx
 * is declared as a const of this type and omits the parameter, so callers
 * still pass it and nothing trips the unused-argument lint.
 */
export type Service<I, O = null> = (
  raw: I,
  ctx: ServiceContext
) => Promise<ServiceResult<O>>
