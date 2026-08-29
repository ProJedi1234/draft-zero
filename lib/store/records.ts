// lib/store/records.ts — The normalized shape of everything the client store
// can ever hold. Pure and isomorphic: no React, no server-only, no db client.
//
// All eight entities are typed now, but only "story" is populated in slice 1.
// The rest exist so migrating a surface later is additive — a snapshot scope, a
// commit helper, a selector — rather than a rework of this file's contracts.
//
// story_ops (the undo journal) and generation_calls (the spend ledger) are
// deliberately absent: both are server-owned bookkeeping that no client surface
// renders row by row, so they stay on the RSC lane permanently.

import type { StoryRow } from "@/lib/db/schema"
import type {
  ActionKind,
  AppSettings,
  ComposerMode,
  ImageAspectRatio,
  LorebookCategory,
  ThinkingLevel,
} from "@/lib/types"

export type EntityKind =
  | "story"
  | "story-entry"
  | "story-image"
  | "lorebook-entry"
  | "story-recap"
  | "model-profile"
  | "app-settings"
  | "composer-draft"

/**
 * The library/sidebar projection of a story + everything story CRUD writes.
 * Structurally a superset of StorySummary (lib/types.ts), so existing
 * StorySummary-typed props accept a StoryRecord unchanged.
 */
export interface StoryRecord {
  id: string
  title: string
  description: string
  genre: string
  /** ISO-8601. */
  createdAt: string
  /** ISO-8601 — THE version this row is arbitrated by. Server-minted only. */
  updatedAt: string
  wordCount: number
  tintHue: number | null
  tintStrength: number
  tintAuto: boolean
}

/** One take of one passage, as the row stores it — no derived slot metadata. */
export interface StoryEntryRecord {
  id: string
  storyId: string
  position: number
  source: "user" | "generated"
  text: string
  actionKind: ActionKind | null
  inputText: string | null
  variantGroupId: string
  variantIndex: number
  isActive: boolean
  deletedAt: string | null
  genModelId: string | null
  genThinking: ThinkingLevel | null
  genTemperature: number | null
  genProfileName: string | null
  promptTokens: number | null
  completionTokens: number | null
  createdAt: string
}

/** One take of one illustration. The bytes stay on disk; this is the row. */
export interface StoryImageRecord {
  id: string
  storyId: string
  position: number
  imageGroupId: string
  imageIndex: number
  isActive: boolean
  deletedAt: string | null
  prompt: string
  derivedPrompt: string | null
  modelId: string
  aspectRatio: ImageAspectRatio
  seed: number
  mediaType: string
  createdAt: string
}

export interface LorebookEntryRecord {
  id: string
  storyId: string
  name: string
  category: LorebookCategory
  keys: string[]
  content: string
  enabled: boolean
  alwaysActive: boolean
  priority: number
  createdAt: string
  updatedAt: string
}

export interface StoryRecapRecord {
  id: string
  storyId: string
  throughEntryId: string
  throughPosition: number
  text: string
  genModelId: string | null
  createdAt: string
}

/** Flat, matching the row: the sliders stay nullable overrides. */
export interface ModelProfileRecord {
  id: string
  name: string
  sortOrder: number
  modelId: string
  thinking: ThinkingLevel
  providerTag: string | null
  zdr: boolean
  temperature: number | null
  topP: number | null
  contextWindow: number | null
  loreBudget: number | null
  frequencyPenalty: number | null
  presencePenalty: number | null
}

/** The single settings row. `id` is a constant so it keys like every other table. */
export interface AppSettingsRecord extends AppSettings {
  id: "app"
}

export interface ComposerDraftRecord {
  id: string
  storyId: string
  text: string
  mode: ComposerMode
  updatedAt: string
}

export interface EntityRecordMap {
  story: StoryRecord
  "story-entry": StoryEntryRecord
  "story-image": StoryImageRecord
  "lorebook-entry": LorebookEntryRecord
  "story-recap": StoryRecapRecord
  "model-profile": ModelProfileRecord
  "app-settings": AppSettingsRecord
  "composer-draft": ComposerDraftRecord
}

const ENTITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Character check for an id used as a primary key, so a client can never smuggle
 * a path fragment or a wildcard in as one.
 *
 * Deliberately NOT a UUID shape check, even though randomId() mints v4 UUIDs:
 * this also runs on ids that came back from the server, and rows predating
 * randomId carry slugs like "story-cartographer". Requiring a UUID made every
 * such row unrenameable.
 */
export function isValidEntityId(id: string): boolean {
  return ENTITY_ID_PATTERN.test(id)
}

/**
 * The story row's client projection. `wordCount` is passed in rather than read
 * off the row: it is a SQL aggregate over the manuscript, not a column.
 */
export function toStoryRecord(row: StoryRow, wordCount: number): StoryRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    genre: row.genre,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    wordCount,
    tintHue: row.tintHue,
    tintStrength: row.tintStrength,
    tintAuto: row.tintAuto,
  }
}

// There is deliberately no nextVersion() here. Versions are minted server-side
// inside the UPDATE (lib/db/story-version.ts) so concurrent writers cannot tie;
// a client-computed version would be a second, unserialized minter.
