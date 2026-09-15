@AGENTS.md

# t3_bot — team protocol

This is a fork of T3 Code (`upstream` = pingdotgg/t3code, `origin` = lvl0lvl/t3_bot).
Goal: add a hierarchical agent-comms layer — PM → senior devs → agent teams — with
Slack-shaped channels where a post can trigger an agent turn. See `docs/t3_bot/PLAN.md`.

Codebase conventions live in `AGENTS.md` (upstream). Read `docs/internals/overview.md`
and `docs/internals/providers.md` before touching `apps/server`.

## Roles

| Role       | Who                                   | Owns                                                           |
| ---------- | ------------------------------------- | -------------------------------------------------------------- |
| PM         | session `t3-bot-6c` (Walt's terminal) | plan, beads, merges to `main`, cross-team decisions            |
| Senior dev | Boss1, Boss3                          | one feature area each, their own worktree, their own subagents |
| Walt       | human                                 | direction, taste, final say                                    |

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
- A test is proven by a named mutant going red, not by being green. **Commit before you mutate.** A restore is only as good as its reference point, and git's is the last
  commit — the one thing guaranteed not to include the work you just did; three of us lost an uncommitted fix
  to `git checkout --` in one night.
- **Mutate each guard in both directions: inert AND wider.** An inert mutant proves what the guard
  refuses; a wider mutant proves what it must admit. When the assertion is about a MEASUREMENT, the
  obligation falls on the measuring apparatus too: a statement counter stuck at 1 passes "the same
  count however many rows" perfectly, because the guard is not what is broken — show the same
  instrument producing a different number on a fixture where it should. Every guard has an admit side, and the admit side
  is usually the feature (an author exclusion widened to "threads wake nobody" stayed green over a reactor
  whose whole purpose is agents mentioning agents).
- **Ask what the assertion does when the subject is ABSENT.** `findIndex` returns -1 and -1 is less than
  any index; a nonce "not equal to the constant I tried" admits every other constant; a count of zero
  wakes is satisfied when the wake went to the other thread. Assert existence before position, the
  property rather than the mutant you wrote, and re-read every negative when a fixture grows a subject.
- **A guard wired at N call sites needs N tests.** "I tested the guard" is not "I tested every site";
  removing the check from one site must red a test that names that site.
- **A test may not disappear silently — by name, not only by count.** A green suite says nothing about
  proofs that were deleted: a range-replace patch removed three direct-gateway tests from #13 and reverting
  #13's fix passed 152/152. The count never moved on the incident the rule was written for (eleven tests
  before, eleven after); the one renamed name is what catches it. `pnpm test:count-gate --base origin/main`
  measures per-file counts AND test names, base against head, from the runner (never a grep for `it(`), over
  the whole repo by default; the table's first line states the scope. Exit 0 = nothing lost; 1 = something
  lost and unexplained — name it with `--allow path#test name=reason` so the reason lands in the PR body, and
  re-run the previous PR's mutants on that file; 2 = could not measure (runner matched nothing, a test file
  fails to load in either revision, base will not check out) — never read 2 as green. What it cannot see: an
  assertion hollowed out of a test that keeps its name. The PM checks the gate output before merging.
- **Adding a required segment to a format moves every existing fixture past the guard it was written for.**
  A two-segment cursor fixture, once the format needs three, is refused at the boundary before it reaches the
  clause its test measures; the test stays green and stops testing, and nobody edited it, so the diff cannot
  show it (three files, one day: fifteen fixtures, then four, then three at the doors — CI found the last).
  When a format grows, re-run the previous PR's mutants on every file that holds a fixture of it.
- Comments state the input that would break the code, not the reason it is safe.
- **A universal or a reachability claim is measured, not remembered.** "Every fixture in the repo…" and "no
  command can produce this" are the two shapes that have been wrong every time (four times on 2026-09-12):
  `rg` the subject before writing the universal, and read the NOTES and acceptance criteria of every bead in
  the chain before writing the reachability claim — a bead's description is its oldest text and its notes are
  its newest, and `bd show` prints the description first. The same check catches an inverted protection
  claim ("exporting this constant means a test cannot silently disarm it" — one `rg` showed the fixture
  importing it). Cite the field or the SHA you read it from, so the next author can check the same place.
  Answers move: the colliding roster was "reachable by ordering (add human X, create thread X, add thread X)"
  until t3_bot-7iw closed it at thread.create, and "replay-only" since — a cited answer carries its date.
- **Bead citations resolve against `main`, not the branch.** `bd` exports to the main checkout's
  `.beads/issues.jsonl`, so a bead created in a worktree is invisible to every branch pushed from it. Cite
  freely; the PM flushes and commits beads on `main` before merging any PR that cites them, and a body must
  not claim a bead is "in the branch".
- Before pushing, write the adversarial question you would give a reviewer — "what legitimate input
  does this now reject that worked before?" — and answer it yourself. Writing the prompt is the review.
  Name your riskiest claim to the reviewer in that prompt ("I assert the finalizers run before
  `process.exit` — verify it"): saying it to someone else is what makes you run it, and it caught a
  worktree leak on #17 that a green gate and a pushed comment had already blessed.

### Rules from 2026-09-14 (first night; cut a rule with its date if it never fires again)

Each names the failure that produced it. Two have fired more than once and are marked; the rest are
single observations.

- **When one thing has produced repeated defects of the same class, ask what would have to be true for
  it not to exist.** The SECOND correction of one class in one place is the signal to delete, not the
  third. Twice this night a requirement to prove a delicate thing correct was discharged by deleting
  it: #71's prose claims (three corrections produced four new false ones) and #73's index-flag
  classifier (four defects, so any flag became a reason not to use the copied index at all). Both
  deletions removed the maintenance obligation as well as the bug.
- **A result carries a positive statement of what ran** — a green with its executed count, a red with
  the mutant that typechecked and the test that named it. Silence, an idle review lane, a compile crash
  counted as a kill, and a "measured" over a NOT RUN row are the same failure: success reported by the
  ABSENCE of a failure signal, which is what a crashed, silent or skipped run also produces.
  _(Fired four times in one night, on four different instruments.)_
- **A gating check must gate on a status that ENCODES ITS VERDICT.** Sequencing with `;` gates nothing,
  and a pipeline through `grep -c`, `wc -l` or `tee` replaces the verdict with "the pipeline ran":
  `grep -c` exits 0 when it FINDS matches, so `tsc | grep -cE ': error' | xargs echo && git push`
  pushes over five type errors. One layer below the rule above — a status meaning RAN read as PASSED.
- **A checker that narrows its own scope reports success over the reduced scope.** `Layer.mock` takes a
  PARTIAL, so adding a method to a shape leaves every existing stub compiling: `tsc` says 0 errors and
  29 tests die at runtime. A clean typecheck after a shape change is not evidence the stubs were
  updated — when you add a method to a shape, grep every mock of that shape. Distinct from the rule
  above: tsc ran over every file and answered truthfully; the QUESTION had silently changed. Found only
  because the factory-to-call-site rule said to run the suite — that rule paid for itself (t3_bot-wto).
- **A review record states what each lane was GIVEN, not only what it found** — blind or primed,
  against which sha, and if primed, with what. A lane told four known findings cannot corroborate them,
  and a record listing only findings cannot tell independent confirmation from an echo. The merge record
  is the one document nobody re-reviews.
- **A correction is the highest-risk site for the defect class it corrects**, so grep the PR body for
  the claim you are correcting before you push. Measured on #71: three false claims corrected, four
  fresh ones introduced doing it, by an author holding this rule.
- **Prefer DELETING a claim to restating it.** A deletion cannot introduce a claim. Measured numbers go
  to their bead, where they are dated and owned; source comments keep only what the code enforces and
  mechanisms, which do not rot. "143 files" was wrong within hours; "pnpm hard-links what a `file:`
  package publishes" cannot go stale.
- **An audit that runs before the fix does not cover the fix**, and **an audit scoped to the tree does
  not cover the document ABOUT the tree.** #71's body was two corrections behind its own source because
  every lane, the claim audit and the deletion commit were scoped to source files. Before "PR ready",
  grep the body for every claim the review corrected. _(Fired twice on one PR, by different routes.)_
- **A "safe" claim about a race needs the losing timing CONSTRUCTED, not observed — and the sequence
  measured must be the sequence the code runs.** A capture was called racy-safe from a probe containing
  a `git status` the product never runs, which smudges the racy entry; a same-second same-size edit was
  captured as the OLD content. Ask "which sequence" before "which version": a version number makes a
  claim look re-runnable while saying nothing about whether the right thing was run.
- **When you move a claim into a durable artifact, either verify it or name who measured it and that
  you did not.** Unattributed in a durable artifact means you are the source, whatever you believed
  when you wrote it. Three firings in one night, one author: a bead cited from memory for a finding it
  does not contain; a two-day-old board figure restated into a source comment whose real source
  refuses a count in writing, reversing a standing ruling nobody knew existed; a lane's universal and
  its approximation written into a bead as measured fact, both falsified by triage. The relay is where
  authority is manufactured — nobody lied, and by the end each claim was load-bearing. This is NOT
  "do not relay": relaying is most of what we do, and "verify everything you relay" is unaffordable
  and will be ignored within a day. The test is whether you would be content to be cited as the source
  of the line; if that depends on someone else having checked it, you have not checked it and the
  artifact must say so. **Two of the three were relays of the author's own earlier words** — this is
  not a rule about other people's claims. Your own board post from two days ago is exactly as
  unverified as a lane report, and you will trust it more because it is yours.
- **A mutant that stays green because no input reaches the guard is DISCLOSED, in those words, with
  which half of the mechanism IS exercised.** It is not closed with a test-only seam in production code,
  and it is not deleted from the table. #71's unreachable `nlink` refusal and #73's two defence-in-depth
  checks are the instances; the seam nearly added to redden them would have manufactured a proof of
  nothing.

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

**UI evidence lives on the orphan branch `pr-assets`.** AGENTS.md forbids PR-only screenshots in the tree;
`gh` cannot attach images to a PR body. So a UI PR pushes its renders to `pr-assets/<pr-number>/` on the
orphan branch (never merged, never in any checkout) and links them by SHA from the body. The design lane
takes the 390 and 1280 measurements headless and states them as numbers in the body.

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
- **Decode, never `.make`, a branded id from outside the server.** `Brand.make` throws on a refused
  value, and inside an argument list it throws before the caller's `.pipe(Effect.catch…)` exists — the
  guard written for that case never runs. Client and agent-supplied ids go through `Schema.decode`.
- The server package is named `t3`, not `@t3tools/server`; `pnpm --filter @t3tools/server` matches
  nothing and prints a false green. Filter on `t3`.
- Claude provider = `@anthropic-ai/claude-agent-sdk` in-process; Codex = `codex app-server`
  child process. Both run on subscriptions (`claude auth login`, `codex login`).
