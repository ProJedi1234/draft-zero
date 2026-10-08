## Repository

Draft Zero has a Next.js web app and backend, plus a native SwiftUI client. Both clients use the same server-owned stories, generation runs, and sync contracts.

- Web UI lives in `app/`, `components/`, and `hooks/`; HTTP endpoints live in `app/api/`.
- Native work lives in `mobile/`. Read [mobile/AGENTS.md](mobile/AGENTS.md) before changing Swift code, Xcode configuration, or native app behavior.
- Before changing services or HTTP endpoints, read [lib/services/CONVENTIONS.md](lib/services/CONVENTIONS.md). Keep writes in services and their transport adapters thin.
- Before changing MCP tools, read [lib/mcp/CONVENTIONS.md](lib/mcp/CONVENTIONS.md).
- Before changing cross-device behavior, read `lib/sync/types.ts` and the affected clients. Preserve compatibility between the web and native clients.

`docs/DESIGN.md` and `docs/MILESTONE2.md` describe earlier milestones. Consult current code and resource conventions for the present architecture.

## Verification

For executable web or backend changes, run the relevant checks defined in `package.json` and `.github/workflows/ci.yml`. Native changes require the build and interaction checks in `mobile/AGENTS.md`; passing web CI does not validate Swift. Changes to a shared API or sync contract require verification in both clients that consume it.

The following Next.js warning applies to web and backend work.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
