# Project skills

Skill content lives in `.agents/skills/`. Codex discovers that directory directly; Claude Code reads the same files through relative symlinks in `.claude/skills/`. The links stay inside the repository and work in fresh clones and worktrees with symlink support.

This follows the [Codex skill locations](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills) and [Claude Code skill locations and symlink support](https://code.claude.com/docs/en/skills#choose-where-skills-load).

## Sources

Installed on 2026-09-29 from these pinned revisions:

| Skill | Upstream directory | Commit |
| --- | --- | --- |
| [SwiftUI Pro](swiftui-pro/SKILL.md) | [twostraws/SwiftUI-Agent-Skill](https://github.com/twostraws/SwiftUI-Agent-Skill/tree/be297ff80dddec529af1f9b1f1f114aab6c9d11c/swiftui-pro) | `be297ff80dddec529af1f9b1f1f114aab6c9d11c` |
| [Swift Concurrency](swift-concurrency/SKILL.md) | [AvdLee/Swift-Concurrency-Agent-Skill](https://github.com/AvdLee/Swift-Concurrency-Agent-Skill/tree/d5770817d2622e1585b1f7eaebc791a9cb0959c8/skills/swift-concurrency) | `d5770817d2622e1585b1f7eaebc791a9cb0959c8` |

Each directory includes its upstream MIT `LICENSE`. Skill instructions, references, assets, and OpenAI metadata are copied unchanged. SwiftUI Pro's nested Claude plugin wrapper and older duplicate skill are omitted so each harness loads the same top-level manifest.

## Project instructions

Repository rules live in `AGENTS.md` and `mobile/AGENTS.md`. Their sibling `CLAUDE.md` files are relative symlinks to those guides, so both harnesses read the same project instructions. Native task triggers and project overrides belong in `mobile/AGENTS.md`.

## Updating

Review an upstream commit, replace the corresponding skill directory from that revision, preserve its license, and update the commit in this table. Keep the portable top-level skill and supporting files; omit nested plugin wrappers. The Claude symlinks continue to point at the canonical directory.

After adding these directories to an existing Claude Code session, run `/reload-skills`. Newly installed skills are available to Codex on the next turn; restart the session if its skill list has not refreshed.
