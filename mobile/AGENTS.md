# Native app

The Xcode project is `mobile/Draft Zero/Draft Zero.xcodeproj`; Swift sources live in `mobile/Draft Zero/Draft Zero/`. Paths in this guide are relative to the repo root.

## SwiftUI and concurrency guidance

- For SwiftUI implementation and review, use `swiftui-pro`, backed by [Paul Hudson's local skill](../.agents/skills/swiftui-pro/SKILL.md).
- For tasks, actors, streaming, cancellation, or isolation diagnostics, use `swift-concurrency`, backed by [Antoine van der Lee's local skill](../.agents/skills/swift-concurrency/SKILL.md).
- If the harness does not expose a skill, read its local `SKILL.md` and only the relevant references. For installation details or updates, read [.agents/skills/README.md](../.agents/skills/README.md).
- Project settings and these instructions take precedence over upstream defaults. Choose architectures and dependencies to meet an actual feature requirement.

## Xcode workflow

- Inspect the target's deployment platforms, Swift language mode, and concurrency settings before choosing APIs or interpreting isolation diagnostics. Use `GetTargetBuildSettings` when Xcode tools are connected; otherwise inspect effective settings with `xcodebuild`.
- Use Xcode documentation search to check unfamiliar API availability and behavior. Keep OS and language migrations deliberate rather than changing settings to satisfy a skill's defaults.
- The project uses filesystem-synchronized groups. Add source files in the existing source directory; check target membership before adding manual project entries.
- Change signing, bundle identifiers, and entitlements only when required by the task.
- Native Xcode builds, previews, tests, and simulator sessions run on this Mac. These are the Apple SDK exception to the general rule that builds run on argos.

## State and views

- Choose the state owner first. Use `@State` for view-owned values, `@Binding` for child edits, and `@Observable` for shared reference models. Inject feature dependencies explicitly; use the environment for app-wide services.
- Keep frequently changing state near the smallest view that consumes it. Use stable server identifiers in lists and extract focused `View` types when a view mixes unrelated responsibilities.
- Keep network requests and expensive processing outside `body`. Match task lifetime to the owning view or service, and handle cancellation separately from failures shown to the user.
- Use native controls, semantic text styles, and accessible labels. Verify Dynamic Type, VoiceOver, and Reduce Motion where the change affects them.

## Where things live

The target is iPhone and iPad only (iOS 27), Swift 5 mode with main-actor default isolation. Model and networking types are `nonisolated`.

| Path under `mobile/Draft Zero/Draft Zero/` | Holds |
|---|---|
| `App/` | `AppModel` (server, sync channel, navigation), `LibraryStore`, `NoticeCenter`, the tab shell |
| `Core/Models/` | Codable mirrors of `lib/types.ts` and the page payloads |
| `Core/Networking/` | `APIClient`, one `API+<resource>.swift` per route family, `NDJSONReader` |
| `Core/Sync/` | Wire events for the four NDJSON channels, `SyncChannel`, timing constants |
| `Core/Domain/` | Ports of pure web logic: `ActionVoice`, `LoreMatcher`, `ImageStyles`, `Format` |
| `Core/Design/`, `Core/Images/` | The OKLCH story palette, shared constants, image loading (SVG from the mock provider is rasterized) |
| `Features/Story/Model/` | `StoryWorkspace` and its run controllers, ports of `hooks/use-generation.ts`, `use-image-generation.ts` and `use-composer-draft-sync.ts` |
| `Features/<Area>/` | One directory per screen |

`Draft ZeroTests/Fixtures/` holds verbatim server responses. When a route's shape changes, re-capture its fixture from a running server rather than editing the JSON by hand. The settings, usage, gallery and library screens read `GET /api/settings`, `/api/usage`, `/api/gallery` and `/api/library`, which share their builders in `lib/payloads/` with the web pages.

For a local test server, run the backend against a throwaway Postgres with `OPENROUTER_API_KEY` empty, so generation uses the free mock provider. Launch the app with `-serverURL http://localhost:<port>`, and optionally `-initialTab <library|gallery|usage|settings>`, `-openStory <id>` and `-openLorebook YES`. Keep few simulators booted; several at once can stall the Mac.

## Backend and sync

- The native app calls the existing HTTP API. Generation, provider calls, and canonical story persistence stay on the backend.
- Before adding an API call, read its route, the matching `lib/services/*.schema.ts`, and `lib/api/respond.ts` from the repo root. Match the actual response envelope and failure codes in Swift decoding.
- Before implementing streaming, read `lib/sync/types.ts` and the relevant subscription route. Streams use NDJSON; buffer incomplete lines across arbitrary network chunks. A generation subscription returning HTTP 204 means there is no run to watch.
- A subscriber disconnect leaves the server run running. Stop a server run only through an explicit user stop action. On reconnect, reconcile server state and reattach to the existing run before considering a new request.
- Follow the session-origin and version rules in `lib/services/context.ts` and `lib/sync/types.ts`. Reconcile remote updates without overwriting text the user is editing or changes still awaiting acknowledgement.

## Verification

For UI bugs, state the hypothesis and confirm the cause before editing. Verify the fix against the same reproduction.

For executable native changes:

1. Discover the scheme and an available iOS Simulator destination, then build for that destination. Use connected Xcode tools or `xcodebuild`; keep generated build output outside the source tree.
2. Run relevant native tests. Use unit tests for decoding, state transitions, and cancellation; use focused UI tests for navigation and composer interactions when those flows change.
3. Exercise the affected UI in a simulator. Check keyboard and safe-area behavior, rotation, or foreground resume when the change touches them. Use a physical device when the behavior depends on hardware or differs from the simulator.
4. Report the scheme, destination, checks performed, and any behavior left unverified. If no test target or compatible runtime is available, say so.
