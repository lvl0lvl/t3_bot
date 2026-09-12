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
- **Push every commit** (`git push -u origin <branch>`). Unpushed work is invisible to the PM and
  indistinguishable from a stall.

## Beads (shared manifest)

- `bd ready` to find work; `bd update <id> --status=in_progress` to claim; `bd close` on merge.
- Discovered work → `bd create` with a dep on the parent. Don't hold it in your head.
- `bd sync --flush-only` before every commit that touches `.beads/`.

## Tests

- **Before asking what the assertion says, ask what input distinguishes the two implementations.**
  Every surviving mutant on 2026-09-11 had a careful assertion over a fixture that could not exercise
  the property (both orderings gave the same error on clean handles; idempotence over rows with no
  hidden sigil; a guard tested only in the permissive direction). Choose the fixture from the property.
- A test is proven by a named mutant going red, not by being green. Restore mutations from a byte copy.
- Comments state the input that would break the code, not the reason it is safe.

## Merge gate

**Nothing merges to `main` without `/review-pr` first.** Flow: senior opens PR against
`origin/main` → runs `/review-pr` → fixes findings → posts `REPORT` "PR ready" → PM merges.

**Nobody writes to a tree anyone else is reading — author included.** While lanes are live on your
worktree, you do not edit it; mutate a copy. Lanes never mutate the author's live tree. Any review lane that mutation-tests or probes by
editing source does it in its own scratch worktree (`git worktree add <tmp> HEAD`), never in the
worktree the author is editing. A lane "restores" to what it read, not what you have since written —
that silently reverted two correctness fixes in #4. Copy in, never symlink; write into a copy, never
into a live tree. A scratch worktree has no `node_modules`: a lane that only reads and runs may share
the live tree's via symlink; a lane that mutates source runs its own `pnpm install --frozen-lockfile`
in the scratch tree, and no lane ever creates or repoints a symlink inside a shared `node_modules`
(that is the exact write that repointed five `@t3tools` links in a live tree and left 653 tests green
over 12,246 type errors). Suspect it: `readlink -f apps/server/node_modules/@t3tools/contracts` must
resolve inside the tree you are standing in.

**`gh` targets the fork, never upstream.** This clone has `upstream` = Theo's public repo, and
`gh` resolved to it until `gh repo set-default lvl0lvl/t3_bot` was run (repo-level git config,
shared by every worktree). Belt and braces: pass `--repo lvl0lvl/t3_bot` on every `gh` write
(`pr create`, `pr merge`, `pr review`, `pr comment`, `issue create`). Before any merge, confirm
`gh repo view --json nameWithOwner` says `lvl0lvl/t3_bot`. `-a @me` does not work on the fork;
drop the self-assign from `AGENTS.md`'s PR guidance.

## Model policy for this project (Walt, 2026-09-11)

Walt, in the PM session: "fable credits are expired. run Opus 5", then "I authorized Opus 5" when
asked to confirm it covers review lanes. Overrides the global model policy for t3_bot: **Opus 5 for
every session and every subagent, `/review-pr` lanes included.** Dispatch with `model: opus`.
Sonnet stays excluded from review and design. Do not switch back to Fable unprompted.

## Stack notes

- pnpm workspace, Effect-TS server, Vite/React clients. `pnpm install` then `pnpm dev`
  (`vp run dev` in `AGENTS.md` assumes `vp` on PATH; it is not on every session's — `pnpm dev` is
  the portable form). Ports derive from the worktree path; read them from the `[dev-runner]` line.
- The server package is named `t3`, not `@t3tools/server`; `pnpm --filter @t3tools/server` matches
  nothing and prints a false green. Filter on `t3`.
- Claude provider = `@anthropic-ai/claude-agent-sdk` in-process; Codex = `codex app-server`
  child process. Both run on subscriptions (`claude auth login`, `codex login`).
