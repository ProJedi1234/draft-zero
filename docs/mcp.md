# MCP

draft zero serves an MCP endpoint at `/api/mcp`, so an agent can read and
write your library the way the app does: list stories, read the manuscript,
append a turn, edit lore, rewind, and see exactly what the model was shown for
a passage. Every write goes through the same journal and sync bus as the UI,
so a passage written by an agent is undoable in the app and appears in every
open browser as it lands.

The endpoint speaks MCP revision 2026-07-28 over streamable HTTP, the
revision that made the protocol stateless: no session id, no handshake, each
request standing on its own. Clients on the earlier streamable HTTP revisions
still connect — the SDK answers both — so any client that can reach the URL
can use it.

There is no auth, so run it on a machine or network you trust. What the route
does check is the request's `Host` header and its `Origin`, both against
`localhost` plus the names in `MCP_ALLOWED_HOSTS`: the first is the
DNS-rebinding guard, the second is what keeps a web page you happen to visit
from driving `delete_story` through your browser. Neither is authentication.

The dev server is on `http://localhost:3000`, so the URL below is
`http://localhost:3000/api/mcp`. Reaching it by any other name — a LAN
hostname, a Tailscale name — needs that name in `MCP_ALLOWED_HOSTS` in
`.env.local`, or every request answers `403 Invalid Host`.

## Connecting

**Claude Code**

```bash
claude mcp add --transport http draft-zero http://localhost:3000/api/mcp
```

That registers the server for the directory you run it in. Add `--scope user`
before the URL to have it in every project. The Code tab in the Claude
Desktop app reads the same configuration, so this one command covers both.

**Codex CLI**

```bash
codex mcp add draft-zero --url http://localhost:3000/api/mcp
```

or, in `~/.codex/config.toml`:

```toml
[mcp_servers.draft-zero]
url = "http://localhost:3000/api/mcp"
```

**Claude Desktop**

The desktop app runs local MCP servers, but only as spawned commands:
`claude_desktop_config.json` has no URL form, and *Add custom connector*
connects from Anthropic's cloud rather than your machine, so a localhost URL
cannot work there. For the chat surface, bridge the URL with
[`mcp-remote`](https://github.com/geelen/mcp-remote) (community tooling, not
Anthropic's). Open the Claude menu → Settings… → Developer → Edit Config and
add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "draft-zero": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://localhost:3000/api/mcp",
        "--allow-http",
        "--transport",
        "http-only"
      ]
    }
  }
}
```

`--allow-http` is required for a non-HTTPS URL; `--transport http-only` skips
the fall-back probe for the deprecated SSE transport. Restart the app after
saving.

## Tools

The fourteen tools, in the order the server lists them: reads first, then
writes, then the one destructive tool.

| Tool | Does |
|---|---|
| `list_stories` | Compact index of every story: id, title, genre, passage and word counts, last updated. Paged. Start here when you do not know a story id. |
| `story_map` | Everything about one story except its prose: recap, memory, author's note, lorebook index, position bounds, counts, and read-only generation settings. A few hundred tokens. Read this before any other story tool. |
| `read` | A range of the manuscript by position. Defaults to the last 10 entries; pass `from`/`to` to page elsewhere. Active takes only; images come back as one-line stubs. |
| `search` | Find text across passages and lorebook entries. Returns positions and short snippets, never full passages. |
| `lore_get` | Full content of one lorebook entry, by id or exact name. |
| `usage` | Aggregated spend from the call ledger — cost, calls and token splits grouped by model, request kind, day or story, over an optional date window. |
| `context_breakdown` | Why the model wrote what it wrote: exactly what a passage was shown. Which lore entries fired and on which keys, which were dropped for want of budget, which recap version resolved, and per-section token counts. The tool for "my lore did not seem to apply". |
| `create_story` | Start a new, empty story, configured in one call. Returns its id. |
| `write` | Append one passage as narration or as a Do or Say turn — a turn is translated into second person exactly as the composer does it. Returns the position it took. |
| `edit` | Replace the text of one passage in place, by position. |
| `rewind` | Retire every passage after a position, the way the app's rewind does — a soft delete, so the recap falls back to the newest version the remaining text still covers. |
| `lore_write` | Create or update one lorebook entry. Only the fields you pass change. |
| `update_story` | Change a story's title, description, genre, memory, author's note or system prompt. |
| `delete_story` | Permanently delete a story and everything in it. Asks the writer to confirm first and does nothing until they do. Not undoable. |

Every write is journalled, so it shows up in the app's undo, and synced, so it
appears in every open browser. `delete_story` is the one exception to
reversibility, which is why it is the one tool that elicits a confirmation
before acting.

For the contract the tool modules follow — registration, results, errors, the
confirmation round trip — see [`lib/mcp/CONVENTIONS.md`](../lib/mcp/CONVENTIONS.md).
