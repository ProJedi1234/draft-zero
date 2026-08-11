# draft-zero — Milestone 2: Persistence + Wired Interactions (Mock Generation)

**Status:** Binding contract for parallel implementation. Every export name, signature, file path, column name, and UX behavior in this doc is binding. Where this doc is silent, `docs/DESIGN.md` (milestone 1) still governs — its conventions (base-sera + Base UI `render` prop, theme tokens only, squared corners, font slots, header bar pattern, empty states) all remain in force.

**Headline goal: usability.** The app must feel instantly responsive and polished — optimistic echoes, streaming text, debounced autosave, live save status, keyboard shortcuts — not merely "functional". Every interaction that was a dead button in milestone 1 now works against a real local SQLite database. The only thing that is fake is the model: a deterministic `MockGenerationProvider` behind an interface shaped for a future OpenRouter provider. **No network calls to any external service anywhere in the app.**

---

## 0. Verified stack facts (empirically checked on this machine — do not re-litigate)

- `next dev` / `next build` run under **node v24** (the `next` bin shebang is `#!/usr/bin/env node`; bun is only the package manager / script runner). Any DB library must load under node.
- **`better-sqlite3` is REJECTED**: `bun add better-sqlite3` fails on this machine (its install script falls back to `node-gyp`, which is not installed → exit 127). Do not use it.
- **`@libsql/client` is the verified choice**: installs via bun with zero lifecycle scripts (prebuilt native bindings ship as `optionalDependencies`), and Drizzle + libsql was verified to create/insert/select a `file:` SQLite DB under **both** node v24 (Next runtime) and bun (seed-script runtime).
- `@libsql/client` is on Next.js 16's **default `serverExternalPackages` list** — `next.config.ts` needs **no changes** and stays frozen.
- `cacheComponents` is **not** enabled (empty `next.config.ts`), so the "previous model" caching rules apply: route segment config (`export const dynamic`), `revalidatePath`, etc.
- Server actions: `"use server"` files, invoked from client components inside `startTransition`; every mutating action revalidates via `revalidatePath` (§4.3).
- Base UI event-prop names (verified in installed `.d.ts`): Slider `onValueChange` / **`onValueCommitted`**, Switch **`onCheckedChange`**, Select **`onValueChange`** (root also takes `items`), Dialog/DropdownMenu **`onOpenChange`**. Composition uses the **`render` prop**, never `asChild`.
- Versions pinned by the foundation install (semver ranges fine): `drizzle-orm@^0.45`, `@libsql/client@^0.17`, dev `drizzle-kit@^0.31`, plus `sonner` via the shadcn CLI (§6.6).

---

## 1. Database

### 1.1 Engine, file, config

- **Drizzle ORM + `@libsql/client`** (`drizzle-orm/libsql` driver), SQLite file at **`data/draft-zero.db`** (URL `file:data/draft-zero.db`, path relative to the project root, which is the cwd for `next dev`, `next build`, `next start`, and bun scripts).
- `data/` is **gitignored** (append `/data/` to `.gitignore`).
- `drizzle.config.ts` at repo root:
  ```ts
  import { defineConfig } from "drizzle-kit"
  export default defineConfig({
    dialect: "sqlite",
    schema: "./lib/db/schema.ts",
    out: "./drizzle",
    dbCredentials: { url: "file:data/draft-zero.db" },
  })
  ```

### 1.2 Schema (`lib/db/schema.ts`)

Drizzle `sqliteTable` definitions. Exact table/column names:

**`stories`**
| column | type | notes |
|---|---|---|
| `id` | text PK | opaque string; new rows use `crypto.randomUUID()`; seed keeps mock ids |
| `title` | text NOT NULL | |
| `description` | text NOT NULL default `''` | |
| `genre` | text NOT NULL default `''` | |
| `memory` | text NOT NULL default `''` | |
| `authors_note` | text NOT NULL default `''` | |
| `model_id` | text NOT NULL | generation settings are inline columns (1:1 with story) |
| `temperature` | real NOT NULL | |
| `top_p` | real NOT NULL | |
| `max_tokens` | integer NOT NULL | |
| `frequency_penalty` | real NOT NULL | |
| `presence_penalty` | real NOT NULL | |
| `created_at` | text NOT NULL | ISO-8601 |
| `updated_at` | text NOT NULL | ISO-8601 |

**`story_entries`**
| column | type | notes |
|---|---|---|
| `id` | text PK | |
| `story_id` | text NOT NULL, FK → `stories.id` **ON DELETE CASCADE** | |
| `position` | integer NOT NULL | per-story monotonically increasing; next = `MAX(position)+1` (0 for first). Ordering key. |
| `source` | text NOT NULL | `'user' \| 'generated'` |
| `text` | text NOT NULL | paragraphs separated by `\n\n` |
| `created_at` | text NOT NULL | ISO-8601 |

Index: `(story_id, position)` unique.

**`lorebook_entries`**
| column | type | notes |
|---|---|---|
| `id` | text PK | |
| `name` | text NOT NULL | |
| `category` | text NOT NULL | one of the six `LorebookCategory` values |
| `keys_json` | text NOT NULL | JSON-serialized `string[]` |
| `content` | text NOT NULL default `''` | |
| `enabled` | integer NOT NULL default 1 | boolean 0/1 (`integer({ mode: "boolean" })`) |
| `always_active` | integer NOT NULL default 0 | boolean 0/1 |
| `priority` | integer NOT NULL default 50 | 0–100 |
| `created_at` / `updated_at` | text NOT NULL | ISO-8601 |

**`app_settings`** — single-row table
| column | type | notes |
|---|---|---|
| `id` | integer PK | always `1` |
| `default_model_id` | text NOT NULL | |
| `openrouter_key` | text NOT NULL default `''` | stored locally, never sent anywhere in this milestone |

### 1.3 Row ↔ domain mapping rules (`lib/db/mappers.ts`)

`lib/types.ts` remains the **app-facing contract** — components never see Drizzle row types. Mapping rules:

- snake_case columns ↔ camelCase fields; integer 0/1 ↔ boolean; `keys_json` ↔ `keys: string[]` (JSON.parse/stringify); timestamps pass through as ISO strings.
- `Story.settings` is assembled from the six inline settings columns; updates to settings write those columns.
- `Story.entries` = the story's `story_entries` ordered by `position` ASC, mapped to `StoryEntry`.
- **`Story.wordCount` is computed at read time** (never stored): sum over entries of `text.trim() === "" ? 0 : text.trim().split(/\s+/).length`.
- **`Story.activeLorebookEntryIds` is computed at read time** by real trigger matching: `matchActiveLorebookEntries(allLorebookEntries, recentStoryText(entries))` from `lib/generation/lorebook` (§3.4) — the milestone-1 mocked ids are gone as stored data; the field's shape is preserved so `Story` doesn't change.
- `lib/types.ts` gains (additive only — nothing existing may change):
  ```ts
  /** Story metadata without entries — sidebar/library surface. */
  export interface StorySummary {
    id: string; title: string; description: string; genre: string
    createdAt: string; updatedAt: string; wordCount: number
  }
  /** App-level settings (settings page). */
  export interface AppSettings {
    defaultModelId: string
    /** OpenRouter API key, "" when unset. Stored locally only. */
    openRouterKey: string
  }
  /** Uniform server-action result. Actions never throw for expected failures. */
  export type ActionResult<T = null> =
    | { ok: true; data: T }
    | { ok: false; error: string }
  /** Input for creating a lorebook entry. */
  export type NewLorebookEntry = Omit<LorebookEntry, "id" | "createdAt" | "updatedAt">
  ```

### 1.4 Client, migrations, lazy init (`lib/db/client.ts`)

- **No module-scope side effects.** The DB must NOT be opened at import time (build imports page modules; a fresh checkout has no `data/` dir).
- Export `getDb(): Promise<DrizzleDb>` — a memoized lazy singleton that, on first call: `fs.mkdirSync("data", { recursive: true })` → `createClient({ url: "file:data/draft-zero.db" })` → `drizzle(client, { schema })` → `await migrate(db, { migrationsFolder: "drizzle" })` (from `drizzle-orm/libsql/migrator`) → returns the instance. Memoize the promise so concurrent callers share one init.
- **Migrations strategy:** committed SQL migrations in `drizzle/`, generated with `drizzle-kit generate` (`bun run db:generate`), auto-applied idempotently by `getDb()`. The initial migration is generated once by the foundation task and committed.

### 1.5 Seed script (`scripts/seed.ts`, run as `bun run db:seed`)

- Bun-runtime script (verified working). Imports `getDb()` and `lib/mock-data`.
- **Destructive reset**: deletes all rows from every table, then inserts `MOCK_STORIES` (stories + their entries with `position` = array index + original ids + timestamps + settings), `MOCK_LOREBOOK_ENTRIES`, and the `app_settings` row (`default_model_id` from `DEFAULT_GENERATION_SETTINGS.modelId`, empty key). Prints a one-line summary. Mock `activeLorebookEntryIds` are **not** stored (computed at read time).
- package.json scripts added: `"db:generate": "drizzle-kit generate"`, `"db:seed": "bun scripts/seed.ts"`.

### 1.6 Build correctness (the `bun run build` guarantee)

Fresh checkout flow: `bun install` → `bun run db:seed` (optional for build, required for demo data) → `bun run build` **must succeed**. Rules that make it true:

1. `app/layout.tsx` exports **`export const dynamic = "force-dynamic"`** — root-layout segment config makes **every route dynamic** (rendered per request, DB read at request time, nothing prerendered from DB content).
2. `app/story/[storyId]/page.tsx` **drops `generateStaticParams`** entirely. `generateMetadata` stays (reads the DB at request time; unknown id → title "Story", page body calls `notFound()`).
3. No `use cache`, no `unstable_cache`, no `fetch` caching anywhere. The DB is the sole source of truth; every request reads fresh.
4. DB opening is lazy (§1.4), so build-time module evaluation never touches the filesystem.

An empty (unseeded) DB is a **valid state**: the sidebar shows the empty-library state and `/` shows the empty-home landing (§7.7).

---

## 2. Data access layer + server actions

### 2.1 Read layer — `lib/db/queries.ts` (server-only; imported by server components and actions)

```ts
/** All stories, ordered updated_at DESC. wordCount computed per story. */
export async function listStories(): Promise<StorySummary[]>
/** Full story with entries, settings, computed wordCount + activeLorebookEntryIds. null if missing. */
export async function getStory(id: string): Promise<Story | null>
/** All lorebook entries, ordered name ASC. */
export async function listLorebookEntries(): Promise<LorebookEntry[]>
export async function getLorebookEntry(id: string): Promise<LorebookEntry | null>
/** Reads (and lazily creates with defaults) the single settings row. */
export async function getAppSettings(): Promise<AppSettings>
```

### 2.2 Mutations — server action files (all start with `"use server"`; all return `ActionResult`; expected failures — not-found, validation — return `{ ok:false, error }` with a human-readable message; every mutation bumps the owning story's `updated_at` and ends with the revalidation call of §4.3)

**`lib/actions/stories.ts`**
```ts
/** Creates a story with title "Untitled Story" (or given), empty text fields, settings from app default model + DEFAULT_GENERATION_SETTINGS numerics. */
export async function createStory(input?: { title?: string }): Promise<ActionResult<{ id: string }>>
export async function renameStory(id: string, title: string): Promise<ActionResult>          // trims; rejects empty
/** Patch any of the story text-metadata fields. Only supplied keys are written. */
export async function updateStoryMeta(
  id: string,
  patch: { title?: string; description?: string; genre?: string; memory?: string; authorsNote?: string }
): Promise<ActionResult>
/** Full copy (entries + settings), title suffixed " (copy)", fresh ids/timestamps. */
export async function duplicateStory(id: string): Promise<ActionResult<{ id: string }>>
export async function deleteStory(id: string): Promise<ActionResult>
export async function updateGenerationSettings(
  id: string, patch: Partial<GenerationSettings>
): Promise<ActionResult>
```

**`lib/actions/entries.ts`**
```ts
/** Appends a user passage (next position). Rejects blank/whitespace-only text. */
export async function appendUserEntry(storyId: string, text: string): Promise<ActionResult<{ entry: StoryEntry }>>
/** Appends a generated passage — called by the client after streaming completes. */
export async function appendGeneratedEntry(storyId: string, text: string): Promise<ActionResult<{ entry: StoryEntry }>>
export async function updateEntryText(storyId: string, entryId: string, text: string): Promise<ActionResult>
export async function deleteEntry(storyId: string, entryId: string): Promise<ActionResult>
/** Removes the newest entry (any source). ok with removed:null when story is empty. */
export async function undoLastEntry(storyId: string): Promise<ActionResult<{ removed: StoryEntry | null }>>
/** Removes entryId AND every later entry (retry-from-here). */
export async function deleteEntriesFrom(storyId: string, entryId: string): Promise<ActionResult<{ removedCount: number }>>
```

**`lib/actions/generation.ts`**
```ts
import type { ComposedContext } from "@/lib/generation/types"
/**
 * One round-trip that prepares a generation:
 * - mode "story" with userText: appends the user passage first (same validation as appendUserEntry)
 * - mode "story" without userText: plain Continue, appends nothing
 * - mode "instruction": userText required, NOT persisted — passed into context.instruction
 * Then composes context (§3.5) from fresh DB state and returns it with the story's settings.
 * `variant` feeds the deterministic seed so Retry produces a different continuation (§3.3).
 */
export async function prepareGeneration(
  storyId: string,
  opts: { mode: "story" | "instruction"; userText?: string; variant?: number }
): Promise<ActionResult<{ context: ComposedContext; settings: GenerationSettings }>>
```

**`lib/actions/lorebook.ts`**
```ts
export async function createLorebookEntry(input: NewLorebookEntry): Promise<ActionResult<{ id: string }>>  // rejects empty name
/** Patch any mutable field (name, category, keys, content, enabled, alwaysActive, priority). Bumps updated_at. */
export async function updateLorebookEntry(
  id: string, patch: Partial<NewLorebookEntry>
): Promise<ActionResult>
export async function deleteLorebookEntry(id: string): Promise<ActionResult>
```

**`lib/actions/settings.ts`**
```ts
export async function updateAppSettings(patch: Partial<AppSettings>): Promise<ActionResult>
```

---

## 3. Generation subsystem (all pure TS, no new deps, isomorphic — runs on server AND client)

Lives entirely under `lib/generation/`. **The mock provider executes in the browser** (it's deterministic fixture data — no secrets, no I/O), which is what lets streamed chunks drive real React state without any network hop. A future `OpenRouterProvider` implements the same interface (client-side fetch with the stored key, or behind a route handler — the interface doesn't care) and is swapped in `getGenerationProvider()`.

### 3.1 Interfaces (`lib/generation/types.ts`)

```ts
import type { GenerationSettings, LorebookEntry } from "@/lib/types"

/** A lorebook entry selected into context, with why. */
export interface ActiveLoreEntry {
  id: string; name: string; content: string; priority: number
  /** The trigger key that matched recent text, or null when included via alwaysActive. */
  matchedKey: string | null
}

/** Fully composed generation context — everything a provider needs, provider-agnostic. */
export interface ComposedContext {
  memory: string
  /** Ordered priority DESC (then id ASC). Already budget-trimmed. */
  lore: ActiveLoreEntry[]
  /** Recent story prose window (authors note NOT baked in — renderPrompt injects it). */
  storyText: string
  authorsNote: string
  /** Ephemeral instruction (instruction mode), else null. */
  instruction: string | null
  /** Deterministic seed: entryCount at composition time + variant. Drives mock fixture choice. */
  seed: number
  /** estimateTokens(renderPrompt(ctx)) — for the inspector context meter. */
  approxTokens: number
}

export interface GenerationRequest {
  context: ComposedContext
  settings: GenerationSettings
  signal?: AbortSignal
}

export interface GenerationProvider {
  /** Yields plain-text chunks. Concatenation of all chunks = the full continuation. Stops promptly on signal abort. */
  generate(request: GenerationRequest): AsyncIterable<string>
  /** Mock in this milestone; a real provider would call the OpenRouter auth endpoint. */
  verifyKey(key: string): Promise<{ ok: boolean; message: string }>
}
```

### 3.2 Fixtures (`lib/generation/fixtures.ts`) — exported separately for test DI

```ts
/** 8 deterministic continuations, each 2 paragraphs (~80–140 words) of genre-neutral literary prose that can plausibly follow ANY story (or open one). Written once, never randomized. */
export const FIXTURE_CONTINUATIONS: readonly string[]  // length exactly 8
/** Deterministic chunker: greedy groups of `wordsPerChunk` whitespace-delimited words, whitespace preserved. */
export function chunkText(text: string, wordsPerChunk?: number): string[]  // default 3
```

Fixture prose must contain paragraph breaks (`\n\n`) so streamed output exercises multi-paragraph rendering. Do not include story-specific names.

### 3.3 Mock provider (`lib/generation/mock-provider.ts`, factory in `lib/generation/provider.ts`)

```ts
export interface MockProviderOptions {
  /** Delay before the first chunk — exercises the "pending" UI state. Default 350. */
  initialDelayMs?: number
  /** Delay between chunks — exercises streaming UI. Default 24. */
  chunkDelayMs?: number
  /** Fixture pool override for tests. Default FIXTURE_CONTINUATIONS. */
  fixtures?: readonly string[]
}
export class MockGenerationProvider implements GenerationProvider { constructor(options?: MockProviderOptions) {} /* … */ }
```

Deterministic behavior (binding):
- Continuation chosen by **`context.seed % fixtures.length`** — `seed = entryCount + variant`, so consecutive passages cycle through fixtures, and a Retry (which passes an incremented `variant`) yields a *different* text than the one it replaces, deterministically.
- Output truncated to `settings.maxTokens` words (fixture text is short; the rule exists so `maxTokens` observably does something at low values).
- Delivery: await `initialDelayMs`, then for each chunk of `chunkText(text)`: yield chunk, await `chunkDelayMs`. Checks `signal?.aborted` before every yield and returns immediately when aborted. Delays via `setTimeout` promises.
- `verifyKey(key)`: waits 600 ms; `ok` iff `key.startsWith("sk-or-") && key.length >= 20`; messages: `"Key looks valid (mock check)."` / `"That doesn't look like an OpenRouter key."`

`lib/generation/provider.ts`:
```ts
/** Module singleton. Today always the mock; the OpenRouter swap point later. */
export function getGenerationProvider(): GenerationProvider
```

### 3.4 Lorebook trigger matching (`lib/generation/lorebook.ts`) — replaces mocked `activeLorebookEntryIds`

```ts
export interface LoreMatch { entry: LorebookEntry; matchedKey: string | null }
/** The scan window: last 4 entries' text joined with "\n\n", then the final 4000 chars, lowercased. */
export function recentStoryText(entries: StoryEntry[]): string
/**
 * An entry is active iff enabled AND (alwaysActive OR any trigger key — trimmed, lowercased,
 * non-empty — is a substring of the scan window). matchedKey = first matching key in array
 * order (null when only alwaysActive applies). Result ordered priority DESC, then id ASC.
 */
export function matchActiveLorebookEntries(entries: LorebookEntry[], recentText: string): LoreMatch[]
```

Used by: `getStory` (fills `activeLorebookEntryIds`), `composeContext` (§3.5), and the inspector Lore tab (which recomputes to display `matchedKey`).

### 3.5 Context composition (`lib/generation/context.ts`) — real implementation, mock consumer

```ts
export function composeContext(input: {
  story: Story
  lorebookEntries: LorebookEntry[]
  instruction?: string | null
  variant?: number   // default 0
}): ComposedContext
/** The exact prompt string a real provider would send. */
export function renderPrompt(ctx: ComposedContext): string
/** ceil(text.length / 4). */
export function estimateTokens(text: string): number
```

Binding composition rules:
- `storyText` = all entries' text joined `"\n\n"`, trimmed to the **final 24 000 chars**, cut forward to the next paragraph boundary so it never starts mid-paragraph.
- `lore` = `matchActiveLorebookEntries(...)` mapped to `ActiveLoreEntry`, then greedily included in order (priority DESC, id ASC) while cumulative `content` length ≤ **8 000 chars** — higher priority survives trimming, exactly as `lib/types.ts` documents.
- `seed` = `story.entries.length + variant` (count *after* any user append — `prepareGeneration` composes from fresh DB state).
- `renderPrompt` layout (memory top; author's note injected near the most recent words; instruction last):

```
[Memory]
{memory}                              ← section omitted entirely when blank

[Lore: {name}]
{content}                             ← one block per active entry, priority order

[Story]
{storyText minus its final paragraph}

[Author's note: {authorsNote}]        ← omitted when blank

{final paragraph of storyText}

[Instruction]
{instruction}                         ← instruction mode only
```

### 3.6 Client generation flow (who calls what)

```
Composer Send/Continue/Retry
  → startTransition: prepareGeneration(storyId, { mode, userText?, variant? })   // server: persists user entry (story mode), composes
  → (revalidation makes the user passage arrive from the server; the client also echoes it optimistically)
  → provider = getGenerationProvider(); for await chunk of provider.generate({ context, settings, signal })
       → append chunk to local streamingText state → canvas renders it live
  → on completion or Esc/Stop with partial text: appendGeneratedEntry(storyId, fullOrPartialText)
  → clear streaming state inside the same transition (no flash: the persisted entry replaces the local buffer)
```
Aborted with **zero** text yielded → nothing is persisted. Errors at any stage → toast + return to idle (any already-persisted user passage stays; Undo covers regret).

---

## 4. Client state + UX conventions (every builder follows these — no exceptions)

### 4.1 The one pattern

- **Server components fetch** via `lib/db/queries.ts` and pass plain domain objects down.
- **Client components mutate** by calling server actions inside `React.useTransition`; the `isPending` flag drives disabled/spinner states. Never mutate via route handlers; never fetch from client effects.
- **Optimistic where it's felt**: the composer echoes the user's passage instantly (local state) while `prepareGeneration` runs; list-item deletes/toggles may use `useOptimistic` or simple local state — but never invent data the server didn't confirm for anything else.
- **`ActionResult` handling**: `if (!res.ok) toast.error(res.error)` — every call site. Success is silent except where §4.6 says otherwise.

### 4.2 Text-field convention (prevents revalidation from clobbering typing)

Text inputs/textareas backed by the DB are **uncontrolled-after-mount**: initialize local state (or `defaultValue`) from the server prop once, never resync from props, and put **`key={record.id}`** on the field's component so switching records remounts fresh. This applies to memory, author's note, title/description/genre fields, lorebook editor fields, and the API key input.

### 4.3 Revalidation convention

Every mutating server action ends with **`revalidatePath("/", "layout")`** (single blanket call — the sidebar lives in the root layout and nearly every mutation touches ordering/word counts; the app is local and single-user, so the cost is nil and staleness is zero). Client-side navigation after mutations uses `router.push`; no manual `router.refresh()` is needed on top of action revalidation.

### 4.4 Autosave (`hooks/use-autosave.ts` — shared, foundation-provided)

```ts
export type SaveStatus = "idle" | "saving" | "saved" | "error"
/** Debounced autosave. schedule() debounces; flush() saves pending value immediately (call on blur). Reports into the global save store; toasts on error. */
export function useAutosave<T>(
  save: (value: T) => Promise<ActionResult<unknown>>,
  delayMs?: number   // default 600
): { schedule: (value: T) => void; flush: () => void; status: SaveStatus }
/** Global aggregate (module store + useSyncExternalStore): "saving" if any autosave in flight, "error" if the latest finished save failed, else "saved"/"idle". */
export function useSaveStatus(): SaveStatus
```

- **Debounce 600 ms** for all text fields. Discrete controls (selects, switches, slider commits, model picker) save **immediately** (still via `useTransition`), not debounced.
- Sliders: local value while dragging (`onValueChange`), persist once on **`onValueCommitted`**.

### 4.5 Pending & streaming states

- Generation lifecycle: `idle → pending (action round-trip + initialDelay) → streaming → idle`. During `pending`, the canvas caret pulses and the composer shows activity; during `streaming`, chunks render as a live serif block (§7.2). All generation triggers (Send/Continue/Retry/retry-from-block/Undo) are disabled while not `idle`, except **Stop**.
- Buttons that run transitions get `disabled={isPending}`; icon buttons swap their icon for `Loader2` with `animate-spin` while pending. No layout shift.

### 4.6 Toasts (sonner, §6.6)

- **Every** failed `ActionResult` and thrown/unexpected error → `toast.error(message)`.
- Success toasts ONLY for: story deleted, story duplicated, lorebook entry created, lorebook entry deleted, key verified (success or failure message from `verifyKey`). Everything else (autosaves, settings, generation, renames) is silent — the UI itself is the confirmation.

### 4.7 Keyboard shortcuts

- **Cmd/Ctrl+Enter** in the composer textarea: Send when it has text, Continue when empty.
- **Esc** during streaming: stop generation (keep partial text, §3.6). Esc also cancels inline passage editing.
- Existing `d` theme hotkey (theme-provider) is untouched.
- Passage editor: **Cmd/Ctrl+Enter** saves.

### 4.8 Empty states & polish

- All five milestone-1 empty states are preserved and now **reachable**: blank story canvas, no-active-lore, lorebook no-selection / zero-match filter, empty library (delete all stories), 404. Empty-canvas suggestion chips now insert their text into the composer (§7.2).
- The header "Saved locally" chip is now **live** (§7.3) via `useSaveStatus()`.
- `formatRelativeDate` now defaults to real time: signature becomes `formatRelativeDate(iso: string, nowMs?: number)` with `nowMs` defaulting to `Date.now()` (`MOCK_NOW_ISO` stays exported; day-granularity output keeps SSR/hydration stable).

---

## 5. Cross-task component contracts (signatures pinned; implementer ↔ consumer are different tasks)

| Export | File | New signature | Implemented by | Consumed by |
|---|---|---|---|---|
| `AppSidebar` | `components/sidebar/app-sidebar.tsx` | `({ stories, ...props }: { stories: StorySummary[] } & React.ComponentProps<typeof Sidebar>)` | feat-sidebar | foundation-db (`app/layout.tsx`) |
| `NewStoryButton` | `components/sidebar/new-story-button.tsx` | `({ variant?, size?, className? }: { variant?: "default"\|"outline"; size?: "xs"\|"sm"; className?: string })` — renders a Button labeled "New story" with `Plus` icon; on click: `createStory()` → on ok `router.push("/story/"+id)`; pending spinner | feat-sidebar | feat-app-pages (empty home), feat-sidebar itself |
| `StoryWorkspace` | `components/story/story-workspace.tsx` | `({ story, lorebookEntries }: { story: Story; lorebookEntries: LorebookEntry[] })` | feat-canvas | feat-canvas (story page) |
| `InspectorPanel` / `InspectorContent` | `components/inspector/inspector-panel.tsx` | `InspectorPanel({ story, lorebookEntries, className })`, `InspectorContent({ story, lorebookEntries })` | feat-inspector | feat-canvas (workspace + mobile sheet) |
| `LoreTab` | `components/inspector/lore-tab.tsx` | `({ story, lorebookEntries }: { story: Story; lorebookEntries: LorebookEntry[] })` | feat-lore-tab | feat-inspector |
| `StoryHeader` | `components/story/story-header.tsx` | **unchanged**: `({ story, inspectorOpen, onToggleInspector, onOpenMobileInspector })` | feat-passages | feat-canvas |
| `StoryEntryBlock` | `components/story/story-entry-block.tsx` | `({ entry, storyId, busy, onRetryFrom }: { entry: StoryEntry; storyId: string; busy: boolean; onRetryFrom: (entryId: string) => void })` — retry action rendered only for `source === "generated"`; all actions disabled while `busy` | feat-passages | feat-canvas (canvas maps entries) |
| `LorebookView` | `components/lorebook/lorebook-view.tsx` | `({ entries }: { entries: LorebookEntry[] })` | feat-lorebook | feat-lorebook (page) |
| `SettingsView` | `components/settings-view.tsx` | `({ settings }: { settings: AppSettings })` | feat-app-pages | feat-app-pages (page) |
| `ThemeToggle` | `components/theme-toggle.tsx` | unchanged (frozen file) | — | — |

Everyone may import from: `@/lib/types`, `@/lib/format`, `@/lib/utils`, `@/lib/db/queries` (server components only), `@/lib/actions/*`, `@/lib/generation/*`, `@/hooks/use-autosave`, `@/components/ui/*`, `lucide-react`, `sonner` (the `toast` function), `next/link`, `next/navigation`. `@/lib/mock-data` may only be imported for **`MOCK_MODELS`, `getModelById`, `DEFAULT_GENERATION_SETTINGS`** (the static model catalog) and by the seed script; the story/lorebook mock helpers are dead to runtime code.

---

## 6. Milestone-specific behaviors (by surface)

### 6.1 Sidebar / library
Search filters the story list client-side (case-insensitive substring over title, genre, description; zero matches → small "No matches for '…'" text under the group — new mini empty state). "+" group action and empty-state button use `NewStoryButton` behavior. Kebab: Rename (dialog with input prefilled, Enter submits → `renameStory`), Duplicate (`duplicateStory` → toast + `router.push` to the copy), Delete (confirm dialog naming the story → `deleteStory` → toast; if the deleted story is the one currently open, `router.push("/")`). List order is `updatedAt` DESC (server-provided; do not re-sort).

### 6.2 Story canvas + composer
Detailed in §3.6, §4.5, §4.7. Streaming text renders as a serif block visually matching a generated `StoryEntryBlock` (no hover actions, subtle pulsing caret appended). Composer textarea clears after a successful `prepareGeneration` dispatch. Undo button → `undoLastEntry` (disabled when `entries.length === 0`). Composer Retry button → retry of the **last** entry, enabled only when the last entry is `generated`: `deleteEntriesFrom(lastId)` then a generation with `variant` incremented per consecutive retry (variant resets to 0 on any other action). Retry-from-block (`onRetryFrom`) = same flow from that entry. Send in `instruction` mode passes the text as instruction (not persisted). Canvas auto-scrolls to bottom as streaming text grows if the user was already near the bottom.

### 6.3 Story header + passages
Header word count comes from `story.wordCount` (fresh after every revalidation). "Saved locally" chip: `useSaveStatus()` → `saving`: `Loader2` spin + "Saving…", `error`: destructive "Save failed", else `CircleCheck` + "Saved locally". Passage edit: pencil → block swaps to serif textarea (autosized, same type spec) with Save/Cancel (`updateEntryText`; Cmd/Ctrl+Enter saves, Esc cancels; blank text rejected). Passage delete: confirm dialog → `deleteEntry` (no toast — the block vanishing is the confirmation... exception: keep §4.6 silent rule).

### 6.4 Inspector
Generate section: model picker persists `modelId` on select (`updateGenerationSettings`); sliders persist on commit; a **context meter** under the settings shows `≈ {approxTokens} / {model contextLength} tokens` computed client-side via `composeContext({ story, lorebookEntries })`. Story section: adds Title, Description, Genre fields (Input, Textarea, Input) above Memory/Author's note; all five autosave via `useAutosave` → `updateStoryMeta`. Lore tab: real matches with the matched trigger key highlighted (badge emphasis on `matchedKey`), "Always" badge for alwaysActive-only inclusions, count line, links to `/lorebook` preserved.

### 6.5 Lorebook route
Page fetches `listLorebookEntries()` server-side → `LorebookView entries={…}`. Search wired (name + keys, case-insensitive) AND-combined with category chips; counts on chips stay full-set per category. Editor: **autosave everything** — text fields debounced 600 ms, category/switches/priority-commit immediate, all via `updateLorebookEntry`; footer replaces the "Save changes" button with the live updated-time text + Delete (confirm dialog → `deleteLorebookEntry` → toast; selection moves to the next remaining entry or the no-selection empty state). New-entry dialog: explicit **Create** (`createLorebookEntry`; name required — inline validation), on success close + select the new entry + toast. Keys editing (both places): type in the small input, **Enter or comma** adds a trimmed non-duplicate key, `X` removes; page editor persists key changes through the same autosave path; the dialog holds local state until Create.

### 6.6 Settings + app pages
Settings: API key input autosaves (`updateAppSettings`, masked `type="password"`); helper text is "Key stored locally." when non-empty, "Not connected." when empty; "Verify key" → `getGenerationProvider().verifyKey(currentInputValue)` → success/error toast (pending spinner during the 600 ms). Default model select persists immediately. Appearance card unchanged. `/`: `listStories()` → `redirect("/story/" + stories[0].id)` (most recently updated) or, when no stories exist, render a full-height `Empty` landing ("Write your first story") with `NewStoryButton`. 404 unchanged.

**shadcn CLI additions (foundation-db only):** `bunx shadcn@latest add sonner` — adds `components/ui/sonner.tsx` + the `sonner` dep; mount `<Toaster />` inside `<body>` in `app/layout.tsx`. If the registry component fails for style base-sera, foundation-db may hand-create `components/ui/sonner.tsx` (the standard next-themes wrapper) as the sole sanctioned exception to the never-hand-edit-ui rule.

---

## 7. File ownership partition (STRICTLY DISJOINT — builders share one working tree)

A file appears in exactly one task. **Edit nothing outside your list.** Importing from other tasks' files is expected (signatures are pinned above); editing them is forbidden.

| Task | Owns (create or edit) |
|---|---|
| **foundation-db** | `package.json`, `bun.lock`, `.gitignore`, `drizzle.config.ts`, `drizzle/**`, `lib/db/client.ts`, `lib/db/schema.ts`, `lib/db/mappers.ts`, `lib/db/queries.ts`, `scripts/seed.ts`, `lib/actions/stories.ts`, `lib/actions/entries.ts`, `lib/actions/generation.ts`, `lib/actions/lorebook.ts`, `lib/actions/settings.ts`, `lib/types.ts` (additive), `lib/format.ts` (relative-date tweak), `app/layout.tsx`, `components/ui/*` additions **via shadcn CLI only** |
| **foundation-gen** | `lib/generation/types.ts`, `lib/generation/fixtures.ts`, `lib/generation/mock-provider.ts`, `lib/generation/provider.ts`, `lib/generation/context.ts`, `lib/generation/lorebook.ts`, `hooks/use-autosave.ts` |
| **feat-sidebar** | `components/sidebar/app-sidebar.tsx`, `components/sidebar/story-list.tsx`, `components/sidebar/story-list-item.tsx`, `components/sidebar/nav-workspace.tsx`, `components/sidebar/new-story-button.tsx`, `components/sidebar/rename-story-dialog.tsx`, `components/sidebar/delete-story-dialog.tsx` |
| **feat-canvas** | `app/story/[storyId]/page.tsx`, `components/story/story-workspace.tsx`, `components/story/story-canvas.tsx`, `components/story/composer.tsx`, `components/story/canvas-empty-state.tsx`, `components/story/streaming-block.tsx`, `hooks/use-generation.ts` |
| **feat-passages** | `components/story/story-header.tsx`, `components/story/story-entry-block.tsx`, `components/story/passage-editor.tsx` |
| **feat-inspector** | `components/inspector/inspector-panel.tsx`, `components/inspector/model-picker.tsx`, `components/inspector/setting-slider.tsx` |
| **feat-lore-tab** | `components/inspector/lore-tab.tsx`, `components/inspector/lore-entry-card.tsx` |
| **feat-lorebook** | `app/lorebook/page.tsx`, `components/lorebook/lorebook-view.tsx`, `components/lorebook/lorebook-entry-list.tsx`, `components/lorebook/lorebook-entry-row.tsx`, `components/lorebook/lorebook-entry-editor.tsx`, `components/lorebook/new-entry-dialog.tsx`, `components/lorebook/category-icon.tsx` |
| **feat-app-pages** | `app/page.tsx`, `app/settings/page.tsx`, `app/not-found.tsx`, `components/settings-view.tsx` |

**Frozen (owned by nobody, edited by nobody):** `lib/mock-data.ts`, `lib/utils.ts`, `app/globals.css`, `next.config.ts`, `components/theme-provider.tsx`, `components/theme-toggle.tsx`, `hooks/use-mobile.ts`, all existing `components/ui/*` files, `docs/DESIGN.md`, this document.

Cross-foundation note: `lib/db/queries.ts` (foundation-db) imports `matchActiveLorebookEntries`/`recentStoryText` from `lib/generation/lorebook` (foundation-gen), and `lib/actions/generation.ts` imports `composeContext`. Write against the pinned signatures; the tree compiles when both land.

---

## 8. Definition of done (whole milestone)

1. Fresh checkout: `bun install` → `bun run db:seed` → `bun run build` succeeds; `bun run dev` serves the app with the four seeded stories, 11 lorebook entries, and working everything.
2. `bun run build` also succeeds **without** ever running the seed (empty-DB states render).
3. `bun run typecheck` and `bun run lint` pass.
4. No external network request is made by any code path (grep-level guarantee: no `fetch(` to non-relative URLs, no OpenRouter URL anywhere outside comments).
5. Every milestone-1 dead control now works; every milestone-1 empty state still renders; the visual language is unchanged.
6. Kill and restart the dev server: all data survives (SQLite), including half-written drafts saved by autosave.
