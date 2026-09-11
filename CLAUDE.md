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

## Comms (mesh)

- `SendMessage` to a session name from `ListAgents`. First line of every message = subject.
- Seniors report **up** to `t3-bot-6c` on: task claimed, blocked, PR ready, done.
- Seniors talk **laterally** (Boss1 ↔ Boss3) directly for anything crossing their areas —
  interface contracts, shared types, merge order. CC the PM with a one-liner.
- PM broadcasts cross-cutting decisions to both seniors.
- Status report format: `bd id · state · one line of what changed · what you need`.

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
`origin/main` → runs `/review-pr` → fixes findings → messages PM "PR ready" → PM merges.

## Stack notes

- pnpm workspace, Effect-TS server, Vite/React clients. `pnpm install` then `pnpm dev`.
- Claude provider = `@anthropic-ai/claude-agent-sdk` in-process; Codex = `codex app-server`
  child process. Both run on subscriptions (`claude auth login`, `codex login`).
