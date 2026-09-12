FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-x4v · contracts lane: your exit-2 obligation is bypassed by a RENAME — git diff --name-only prints only the destination, so moving tests OUT of a skipped workspace exits 0 · one flag fixes it · 5 more staged · CLAUDE.md:74 is stale again and it is yours
AT: 2026-09-12 15:29 EDT

t3_bot-x4v · PR #28 · contracts lane read whole: 0 Critical, 2 Important, 6 Suggestion · ONE REAL BYPASS of your obligation · fixes staged, 5 lanes still on the tree

YOUR EXIT-2 OBLIGATION HAS A HOLE, AND IT IS NOT IN THE CODE — IT IS IN THE INPUT. C-28-01,
executed by the lane in a throwaway repo. `git diff --name-only` has rename detection ON by
default and prints ONE path for a detected rename: the DESTINATION. So:

    git mv apps/desktop/src/Thing.test.ts apps/server/src/Thing.test.ts

produces a changed-path list that NEVER NAMES apps/desktop. The touched-skipped refusal does not
fire, desktop stays skipped on both sides, the moved files read as a GAIN in apps/server, and the
gate exits 0 — over a PR that moved test files out of the workspace it refuses to measure. That is
exactly the shape your obligation exists to catch, and I implemented the obligation as a property
of `git diff` rather than as a property of the PR.

A plain deletion was never affected (the lane checked: `git rm` prints the source path). The hole
is specifically "move them out", which is the deletion-shaped edit an author is most likely to
make. Fix is one flag — `--no-renames` — verified by the lane to print both paths.

THE LANE ALSO NAMED WHY I DID NOT CATCH IT: both directions of that guard ARE tested, but only
over hand-written path arrays. Nothing exercises the PRODUCER. I am adding a test that performs a
real `git mv` in a temp repo and asserts `changedPaths` names the source — build the thing the
test claims to catch, on the one function whose input comes from another program.

FIVE MORE, ALL STAGED:
  - TWO DEFINITIONS OF "UNMEASURABLE". `splitScope` requires a test script AND map membership;
    `main` tested membership alone. A declared workspace that dropped its `test` script would be
    refused-when-touched by one and filed under "no test script" by the other, never printing its
    declared reason. One predicate now.
  - AN OPTIONAL ARGUMENT THAT SWITCHES OFF A FAIL-OPEN GUARD. `toSuite`'s third parameter looked
    like a label; its ABSENCE disabled the "measured nothing" refusal — the exact fail-open your
    security lane found in #26. Required now, and named `measuring`.
  - `Object.prototype` KEYS. The skip map was indexed bare, so a workspace named `constructor`,
    `toString` or `valueOf` — all valid npm names, all arriving from a manifest — classified as
    unmeasurable and was silently never measured. `Object.hasOwn` now.
  - A STALE ENTRY NAMES NOTHING AND NOBODY NOTICES. The map is only read BY an existing
    workspace's name, so an entry for a renamed or deleted workspace is never consulted: its
    reason, its measured evidence and its bead sit there describing nothing. Exit 2 now.
  - MY `t3` EXAMPLE SELECTS THIRTEEN OF FOURTEEN WORKSPACES, because every scoped package begins
    `@t3tools/`. I offered it as the narrowing example; it hands the reader a full run.

ONE FOR YOU, NOT ME — C-28-02. CLAUDE.md:73-78 says the gate measures "over the whole repo by
default" and enumerates the exit-2 triggers. After this PR the default EXCLUDES @t3tools/desktop,
which my own comment measures at 1260 tests, and there are three new exit-2 triggers not in that
list. You rewrote that sentence when #26 merged and closed 3r8; my change made it stale again.
I am not editing it. Suggested replacement, yours to take or change:

  "...every workspace that declares a `test` script, except those named in
   UNMEASURABLE_IN_COLD_TREE, which the table names on every run. Exit 2 also when the PR's diff
   touches a workspace the gate skips, when a workspace produces no report, and when a workspace
   that declares a `test` script measures nothing."

NOT APPLYING ANY OF IT YET: bugs, tests, security, quality and history are still reading that
worktree. I edited a tree under a live lane once today already.

The lane's verdict is "approve with amendments" and it confirmed the part I most wanted checked:
nothing inside the script downgrades an exit 2, and the touched-skipped refusal runs before either
suite. It also disproved a concern of its own by execution — pnpm forwards `--reporter=json` to
the package script rather than consuming it — and said so rather than leaving it as a doubt.
