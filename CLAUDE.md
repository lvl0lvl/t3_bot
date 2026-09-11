@AGENTS.md

# t3_bot — team protocol

This is a fork of T3 Code (`upstream` = pingdotgg/t3code, `origin` = lvl0lvl/t3_bot).
Goal: add a hierarchical agent-comms layer — PM → senior devs → agent teams — with
Slack-shaped channels where a post can trigger an agent turn. See `docs/t3_bot/PLAN.md`.

Codebase conventions live in `AGENTS.md` (upstream). Read `docs/internals/overview.md`
and `docs/internals/providers.md` before touching `apps/server`.

## Roles

| Role | Who | Owns |
|---|---|---|
| PM | session `t3-bot-6c` (Walt's terminal) | plan, beads, merges to `main`, cross-team decisions |
| Senior dev | Boss1, Boss3 | one feature area each, their own worktree, their own subagents |
| Walt | human | direction, taste, final say |

## Comms — the board (push, not poll)

Claude Code's mesh does not cross account slots, so the wire is the **comms board**: the
`comms` branch, checked out at `~/Documents/Projects/worktrees/t3bot-comms`. Protocol and
message types: `comms/README.md` there.

- **Every session, at start:** the `SessionStart` hook prints your session id. Register
  (`comms/whoami.sh <id> <track>`) and arm the watcher with a persistent `Monitor` on
  `comms/watch.sh <track> <id>`. Messages for you then arrive in your chat as they land.
- The `Stop` hook refuses to end a turn while you have unread board messages. Handle them.
- Seniors report **up** to `pm` (`REPORT`), get work **down** (`ASSIGN`), talk **laterally**
  (`ASK`/`ANSWER`, `CLAIM`) for anything crossing areas. Walt is `owner`; he reads chat.
- Report line: `bd id · state · what changed · what you need`.
- Hooks are snapshotted at session start: after pulling a `main` that changes
  `.claude/settings.json`, restart the session.

## Worktrees and branches

- Seniors never edit `main` checkout. Use `EnterWorktree` (or `git worktree add`).
- Branch: `<boss>/<bd-id>-<slug>`, e.g. `boss1/t3_bot-12-channel-aggregate`.
- Rebase on `origin/main` before opening a PR.

## Beads (shared manifest)

- `bd ready` to find work; `bd update <id> --status=in_progress` to claim; `bd close` on merge.
- Discovered work → `bd create` with a dep on the parent. Don't hold it in your head.
- `bd sync --flush-only` before every commit that touches `.beads/`.

## Merge gate

**Nothing merges to `main` without `/review-pr` first.** Flow: senior opens PR against
`origin/main` → runs `/review-pr` → fixes findings → posts `REPORT` "PR ready" → PM merges.

**`gh` targets the fork, never upstream.** This clone has `upstream` = Theo's public repo, and
`gh` resolved to it until `gh repo set-default lvl0lvl/t3_bot` was run (repo-level git config,
shared by every worktree). Belt and braces: pass `--repo lvl0lvl/t3_bot` on every `gh` write
(`pr create`, `pr merge`, `pr review`, `pr comment`, `issue create`). Before any merge, confirm
`gh repo view --json nameWithOwner` says `lvl0lvl/t3_bot`. `-a @me` does not work on the fork;
drop the self-assign from `AGENTS.md`'s PR guidance.

## Stack notes

- pnpm workspace, Effect-TS server, Vite/React clients. `pnpm install` then `pnpm dev`
  (`vp run dev` in `AGENTS.md` assumes `vp` on PATH; it is not on every session's — `pnpm dev` is
  the portable form). Ports derive from the worktree path; read them from the `[dev-runner]` line.
- Claude provider = `@anthropic-ai/claude-agent-sdk` in-process; Codex = `codex app-server`
  child process. Both run on subscriptions (`claude auth login`, `codex login`).
