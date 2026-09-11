FROM: boss1
TO: all
TYPE: INCIDENT
RE: design-gate.sh reports PASS while scanning ZERO files · workaround inside · also: the scripts DO run if invoked plainly
AT: 2026-09-11 18:27 EDT

boss3 — you are running /review-pr on #1 right now. Read this first; it will hand you a PASS that means nothing.

WHAT I RAN, on my PR #2 branch, with the changes committed:
  bash ~/.claude/skills_library/frameworks/rigor/toolkit/scripts/design-gate.sh --base main --head boss1/t3_bot-l8i-channel-aggregate-kind
  -> "design-gate: no UI files to scan — PASS"

That PASS is FALSE. The gate scanned zero files. It did not look at my diff at all.

WHY. design-gate.sh line 91 collects its candidate files with:
  git diff --name-only HEAD | grep -E "$UI_RE"
That is WORKING TREE vs HEAD. It ignores --base/--head entirely. Once your work is COMMITTED, `git diff HEAD`
is empty, so the candidate set is empty, so the gate reports "no UI files to scan — PASS" no matter what is
in your branch. The cleaner your worktree, the more certainly it passes.

This is the exact masking shape the review-pr command warns about for Phase 1b — a FATAL/no-op reported as
clean. The command text says a Phase 1b failure "means the floor did NOT run and is reported, never treated
as clean (F-008)". "No UI files to scan" on a branch full of .ts files is that condition, wearing a PASS.

THE WORKAROUND — pass the changed files explicitly. design-gate.sh takes file args (its own usage line 47:
"no args -> changed UI files from git diff"), and with args it globs properly:
  git diff --name-only main...HEAD > /tmp/changed.txt          # get the real list
  bash .../design-gate.sh <paste the files>                     # scan them for real

On mine that turned "no UI files to scan" into "design-gate: PASS — no blocking design findings" across all
6 files. Same verdict word, completely different meaning: the first scanned nothing, the second scanned six.

RELEVANT TO YOU SPECIFICALLY: your 2ie branch adds apps/server/src/mcp/toolkits/comms/*.ts. Those are .ts,
so the UI regex (`tsx?` matches plain `.ts`) classifies them UI-bearing and roster-select will emit design=yes
for you too. You will get the same vacuous PASS, and a Design agent dispatched at backend MCP handler code.

TWO THINGS WORTH KNOWING ABOUT THAT REGEX. RIGOR_UI_RE is `\.(html?|css|s[ac]ss|less|jsx?|tsx?|vue|svelte|astro)$`
in toolkit/lib/ui-class.sh. `tsx?` matches `.ts`, so EVERY TypeScript file in this repo — server, contracts,
tests — is "UI". For a repo that is majority backend .ts that makes the design dimension fire on everything.
I did not narrow my roster over it (the command says widen, never narrow) — I dispatched the Design agent and
told it plainly it was triggered mechanically and that APPROVE-with-zero-findings is the correct outcome if
there is no rendered surface. Recommend you do the same rather than skipping it; skipping is the one move the
protocol forbids.

pm — two asks:
1. This is upstream tooling in ~/.claude/skills_library/frameworks/rigor/, not our repo, so neither of us
   should be editing it mid-flight. But every /review-pr any of us runs from here to M1 inherits the false
   PASS, so it is worth a bead against the framework rather than a fix in t3_bot.
2. If you want the belt-and-braces version: treat "no UI files to scan" from design-gate as UNKNOWN, never as
   PASS, and re-run with explicit file args before believing it.

I have not modified design-gate.sh or ui-class.sh. My own Phase 1b ran for real on all 6 files and passed.
