// lib/services/lorebook.schema.ts — The lorebook's request and response
// contract. Isomorphic: no server imports, so a contract package can lift it.
import { z } from "zod"

import { entityId } from "@/lib/services/schema"
import { LOREBOOK_CATEGORIES, type LorebookCategory } from "@/lib/types"

const categoryValues = LOREBOOK_CATEGORIES.map((entry) => entry.value) as [
  LorebookCategory,
  ...LorebookCategory[],
]

const name = z
  .string({ error: "Name is required." })
  .trim()
  .min(1, "Name is required.")

// The column is an integer; a fraction would reach Postgres and throw there.
const priority = z.number().int("Priority must be a whole number.")

const storyId = entityId("Invalid story id.")
const entryId = entityId("Invalid entry id.")

/** Keys are ordered as the old action checked them; see parseInput. */
export const createLorebookEntryInput = z.object({
  storyId,
  name,
  // Client-minted so the row paints before the call returns, and so a retry
  // after a lost response lands on the write that already happened.
  id: entryId.optional(),
  category: z.enum(categoryValues).default("concept"),
  keys: z.array(z.string()).default([]),
  content: z.string().default(""),
  enabled: z.boolean().default(true),
  alwaysActive: z.boolean().default(false),
  priority: priority.default(50),
})

export const lorebookEntryPatch = z.object({
  name: name.optional(),
  category: z.enum(categoryValues).optional(),
  keys: z.array(z.string()).optional(),
  content: z.string().optional(),
  enabled: z.boolean().optional(),
  alwaysActive: z.boolean().optional(),
  priority: priority.optional(),
})

export const updateLorebookEntryInput = z.object({
  id: entryId,
  patch: lorebookEntryPatch,
})

export const deleteLorebookEntryInput = z.object({ id: entryId })

export const lorebookEntryRecord = z.object({
  id: z.string(),
  storyId: z.string(),
  name: z.string(),
  // Looser than writes on purpose: the column has no CHECK, and a row that
  // predates the enum must stay readable rather than fail its own response.
  category: z.string(),
  keys: z.array(z.string()),
  content: z.string(),
  enabled: z.boolean(),
  alwaysActive: z.boolean(),
  priority: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const lorebookEntryWriteOutput = z.object({
  record: lorebookEntryRecord,
})

export const deleteLorebookEntryOutput = z.object({
  storyId: z.string(),
  // The deleting write's clock; see commitLorebookDelete.
  version: z.string(),
})

export type CreateLorebookEntryInput = z.input<typeof createLorebookEntryInput>
export type UpdateLorebookEntryInput = z.input<typeof updateLorebookEntryInput>
export type DeleteLorebookEntryInput = z.input<typeof deleteLorebookEntryInput>
