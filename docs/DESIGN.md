# draft-zero — Static Scaffolding Design Doc

**Status:** Contract for parallel implementation. Every export name, prop type, and file path in this doc is binding. Implementers follow it literally.

## 1. Product frame

draft-zero is a local-first, AI-assisted novel-writing app (NovelAI library ergonomics x ChatGPT composer polish). This milestone is **static scaffolding only**: no API calls, no persistence, no real generation. All data comes from `@/lib/mock-data`. Local `useState` for UI-only affordances (tab selection, slider drag, inspector toggle, lorebook selection/filter) is allowed and encouraged; nothing survives reload.

## 2. Stack facts implementers must respect

- Next.js **16.2.6 App Router**, React 19, Tailwind **v4** (CSS-first theme in `app/globals.css`), bun.
- shadcn style **base-sera** built on **@base-ui/react — NOT Radix**. Consequences:
  - Composition uses the **`render` prop**, not `asChild`: `<SidebarMenuButton render={<Link href="/lorebook" />}>…</SidebarMenuButton>`, `<DialogClose render={<Button variant="outline">Cancel</Button>} />`, `<TooltipTrigger render={<Button …/>} />`.
  - `Select` is Base UI: pass `items={[{ value, label }]}` on the `Select` root so `SelectValue` renders the label (not the raw value) — required for SSR-correct display.
  - `Tooltip` needs **no** `TooltipProvider`.
  - Aesthetic: squared corners (`rounded-none` on controls), uppercase `text-xs font-semibold tracking-widest` button labels, `data-slot` attributes on every primitive.
- Dynamic route params are a **Promise**: `const { storyId } = await params` in an `async` page component.
- Root layout must contain `<html>`/`<body>`; static `export const metadata: Metadata` for static pages, `generateMetadata` for the story page. Never export `viewport`/`themeColor` inside `metadata` (deprecated) — we don't need them.
- Dark mode: class-based via existing `ThemeProvider` (next-themes). **Never hardcode colors** — only theme tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, `bg-muted`, `bg-card`, `bg-primary`, `ring-ring`, `bg-sidebar`, …).
- Icons: **lucide-react** only. Standalone icons use `size-4` (or `size-3.5` in dense rows); buttons size their own icons.

## 3. Fonts & typography

Three font slots wired in `app/layout.tsx` (Package A) and mapped in `app/globals.css` (already written in setup):

| Slot | Font | CSS var | Tailwind utility | Use |
|---|---|---|---|---|
| UI | Inter | `--font-sans` | `font-sans` | everything by default |
| Manuscript | Source Serif 4 | `--font-serif` | `font-serif` | story prose, canvas title, composer textarea |
| Mono | Geist Mono | `--font-mono` | `font-mono` | token counts, model ids, kbd |

Manuscript type spec: `font-serif text-[1.0625rem] leading-8`, measure capped at `max-w-2xl`, paragraphs spaced `mt-5`.

## 4. Layout — three regions

```
+------------+----------------------------------+---------------+
|  Sidebar   |  Story header (h-14, border-b)   |               |
|  (16rem,   +----------------------------------+  Inspector    |
|  offcanvas |                                  |  (w-80,       |
|  collapse) |   Story canvas                   |  border-l,    |
|            |   centered max-w-2xl serif prose |  tabs:        |
|  Library   |   scrolls independently          |  Generate /   |
|  story list|                                  |  Story /      |
|            +----------------------------------+  Lore)        |
|  Workspace |  Composer (max-w-2xl, card box,  |  hidden <xl,  |
|  nav       |  textarea + send/continue/retry) |  toggleable   |
+------------+----------------------------------+---------------+
```

- **Left sidebar** — canonical shadcn `sidebar` primitive, `collapsible="offcanvas"`, with `SidebarRail`. Header: wordmark + search input. Content: an unlabelled top-level menu (Library, Gallery, Usage, Settings), then the "Library" group (story list, two-line rows, per-row kebab menu, 20 stories at a time behind a "Load more" button). Footer: version note + theme toggle.
- **Center** — flowing prose, explicitly *not* chat bubbles. Passages (`StoryEntry`) render as manuscript blocks; user-written passages get a subtle `border-l-2 border-primary/40` rule; hover reveals a floating edit/retry/delete action cluster. A pulsing insertion caret follows the last passage. Composer is a raised `bg-card` box with a borderless serif textarea, mode select (Story/Instruction — since superseded by the Do/Say pair, see the README), current-model chip, Undo/Retry icon buttons, and Continue + Send buttons. Kbd hint below.
- **Right inspector** — `w-80 border-l` aside with three tabs: **Generate** (OpenRouter model picker grouped by provider, temperature/top-p/max-tokens sliders, Advanced collapsible with penalties, context meter placeholder), **Story** (title/description/genre/memory/author's-note fields + stats), **Lore** (active lorebook entries for this story, or an empty state). Visibility is controlled by the workspace via a `className` of `hidden xl:flex` / `xl:hidden` — the panel itself is stateless about visibility.

### Every top-level view header (consistency rule)
`StoryWorkspace`, `LorebookView`, and `SettingsView` each begin with the same header bar pattern: `<header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">` containing `<SidebarTrigger />`, `<Separator orientation="vertical" className="h-4" />`, then a `text-sm font-medium` title, with right-aligned actions after a `flex-1` spacer.

## 5. Routes (decision: lorebook is a ROUTE)

| Route | Renders | Notes |
|---|---|---|
| `/` | `redirect("/story/" + DEFAULT_STORY_ID)` | canonical story URLs keep sidebar active-state honest |
| `/story/[storyId]` | `<StoryWorkspace story={…} />` | `await params`; unknown id → `notFound()`; `generateStaticParams` from `MOCK_STORIES`; `generateMetadata` → story title |
| `/lorebook` | `<LorebookView />` | metadata title "Lorebook" |
| `/settings` | `<SettingsView />` | metadata title "Settings" |
| `app/not-found.tsx` | Empty-state 404 | |

**Why lorebook is a route, not a dialog:** it is a full management surface — master–detail with category filtering, search, and a long-form editor. That needs a deep-linkable URL (sidebar nav points at it, the inspector's Lore tab links to it) and more real estate than any modal affords. Dialogs are reserved for the quick-create path (`NewEntryDialog` *inside* the lorebook route).

## 6. Empty states (all use the shadcn `Empty` family)

1. **Blank story** (`entries.length === 0`, exercised by mock story `story-untitled`): canvas shows `CanvasEmptyState` — Feather icon, "A blank page, full of possibility", three static suggestion chips.
2. **No active lore** (Inspector Lore tab; every mock story except story-cartographer): "No lore active" + "Open lorebook" button.
3. **Lorebook: no selection / filter with zero matches**: Empty blocks in the detail pane / list pane.
4. **Empty library** (`stories.length === 0` guard in `StoryList` — dormant with current mock data but must exist).
5. **404** via `app/not-found.tsx`.

## 7. Shared contract surface (written in setup, owned by nobody)

- `lib/types.ts` — `Story`, `StoryEntry`, `EntrySource`, `GenerationSettings`, `LorebookEntry`, `LorebookCategory`, `OpenRouterModel`, `LOREBOOK_CATEGORIES`.
- `lib/mock-data.ts` — `MOCK_STORIES` (4: three with real prose, one blank), `MOCK_LOREBOOK_ENTRIES` (11 across 6 categories), `MOCK_MODELS` (9 across 6 providers), `DEFAULT_STORY_ID`, `DEFAULT_GENERATION_SETTINGS`, `getStoryById`, `getModelById`, `getLorebookEntryById`, `getActiveLorebookEntries`, `getLorebookEntriesByCategory`.
- `lib/format.ts` — deterministic (SSR-safe, pinned `MOCK_NOW_ISO`) `formatWordCount`, `formatContextLength`, `formatDateShort`, `formatRelativeDate`.
- `app/globals.css` — existing theme + `--font-serif` slot registered in `@theme inline`.
- `components/ui/*` — installed by setup via shadcn CLI. **Import freely, never edit.**

## 8. Cross-package import contract (the ONLY allowed cross-package imports)

| Import | From file | Exported by | Consumed by |
|---|---|---|---|
| `AppSidebar` | `@/components/sidebar/app-sidebar` | B | A (root layout) |
| `StoryWorkspace` | `@/components/story/story-workspace` | C | A (story page) |
| `LorebookView` | `@/components/lorebook/lorebook-view` | E | A (lorebook page) |
| `InspectorPanel` | `@/components/inspector/inspector-panel` | D | C (workspace) |
| `ThemeToggle` | `@/components/theme-toggle` | A | B (sidebar footer) |

Signatures (binding):
- `function AppSidebar(props: React.ComponentProps<typeof Sidebar>): JSX` — no required props.
- `function StoryWorkspace({ story }: { story: Story }): JSX`
- `function LorebookView(): JSX` — no props.
- `function InspectorPanel({ story, className }: { story: Story; className?: string }): JSX` — root is `<aside className={cn("w-80 shrink-0 flex-col border-l bg-background", className)}>`; display mode (`hidden xl:flex` etc.) comes entirely from `className`.
- `function ThemeToggle(): JSX` — no props, self-contained dropdown.

Everyone may import from `@/lib/types`, `@/lib/mock-data`, `@/lib/format`, `@/lib/utils` (`cn`), `@/components/ui/*`, `lucide-react`, `next/link`, `next/navigation`.

## 9. Interaction placeholders (static semantics)

All action buttons (Send, Continue, Retry, Undo, Save, Delete, Rename, Duplicate, New story, Verify key, suggestion chips) render enabled but have **no `onClick`** — visual placeholders for the AI/persistence milestone. Interactive-but-ephemeral: sidebar collapse, inspector toggle, tabs, sliders, selects, switches, lorebook selection/filter, dialogs open/close. Search inputs are static placeholders (no filtering logic).

## 10. Visual language summary

Neutral oklch palette from globals.css; sera restraint — hierarchy from type scale and spacing, not color. Chrome (headers, sidebar, inspector, composer controls) is `font-sans` small/tight; the manuscript column is the only serif, generous-leading surface, which makes the center read as "the page" and everything else as "the desk". Badges are the only decorative accents (genre, category, model chip). Density: chrome text `text-xs`/`text-sm`; prose `text-[1.0625rem] leading-8`.
