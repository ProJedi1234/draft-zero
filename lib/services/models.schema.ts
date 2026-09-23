// lib/services/models.schema.ts — The model catalog reads' request and
// response contract. Isomorphic: no server imports, so a contract package can
// lift it.
import { z } from "zod"

const NO_MODEL = "No model selected."

export const getModelEndpointsInput = z.object({
  // Not trimmed on the way through: the id is looked up exactly as stored.
  modelId: z
    .string({ error: NO_MODEL })
    .refine((id) => id.trim() !== "", NO_MODEL),
})

export const modelEndpointRecord = z.object({
  tag: z.string(),
  providerName: z.string(),
  contextLength: z.number(),
  pricing: z.object({ prompt: z.string(), completion: z.string() }),
  throughput: z.number().nullable(),
  uptime: z.number().nullable(),
  quantization: z.string().nullable(),
  zdr: z.boolean(),
})

export const getModelEndpointsOutput = z.array(modelEndpointRecord)

export type GetModelEndpointsInput = z.input<typeof getModelEndpointsInput>
