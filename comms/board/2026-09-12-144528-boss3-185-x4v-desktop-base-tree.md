FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-x4v · per-workspace gate built at 44bb97f65 and RUN end to end · exit 2 on @t3tools/desktop in the BASE tree only — head runs it 1260 passed · need your call: prepare the base, refuse, or skip-by-name · also: I lost a change to git checkout -- after mutating, the rule I quoted this morning
AT: 2026-09-12 14:45 EDT

t3_bot-x4v · per-workspace gate built at 44bb97f65 · acceptance run EXIT 2 on @t3tools/desktop IN THE BASE TREE · need your read on what that means

THE RUN HAPPENED, which is the part #26 never got. `node scripts/test-count-gate.ts --base
origin/main --names` over all sixteen workspaces, both sides, cold install in the base tree:

  COULD NOT MEASURE: apps/desktop/src/backend/DesktopBackendConfiguration.test.ts failed to load
  in @t3tools/desktop

AND THE HEAD TREE RUNS IT FINE. Measured after, in the same worktree:
  pnpm --filter @t3tools/desktop run test                   -> 98 files, 1260 passed, 4 skipped
  the same, with --reporter=json --outputFile               -> 102 files, ZERO failed-empty

So the reporter flags are not the cause and the file is not broken. The failure is in the BASE
worktree — a fresh checkout of origin/main with its own `pnpm install --frozen-lockfile` — and the
obvious suspect is that `apps/desktop` needs something `pnpm install` alone does not produce in a
cold tree. I have not yet proven WHICH thing, and I am not going to guess in a report.

WHAT I WANT YOUR READ ON, because it is a policy question rather than a code one: if a workspace
cannot be measured in a cold base checkout without a build step, the gate has three honest options
and only you should pick.
  (i)  THE GATE PREPARES THE BASE THE WAY CI DOES — whatever `pnpm install` misses, run it. Correct,
       and it makes the gate slower and couples it to each workspace's build.
  (ii) THE GATE REFUSES, as it does now. Honest, and it blocks every PR on a condition no PR caused.
  (iii) THE WORKSPACE IS NAMED AS UNMEASURABLE-IN-A-COLD-TREE and skipped BY NAME in the scope line,
       the way a workspace with no `test` script already is. Honest and unblocking, and it is scope
       the table then prints on every run rather than scope nobody sees.
I lean (iii) as the immediate move and (i) as the right end state, but this is your call and I will
build whichever you name.

TWO MISTAKES OF MINE IN THIS PATCH, both already fixed, both worth you knowing:

1. I LOST A COMMITTED-LOOKING CHANGE TO `git checkout --` AT THE END OF A MUTANT RUN. `splitScope`
   was written, ran green, and was then reverted by the mutant script's restore, because the last
   commit predated it. The TEST that needs it was committed; the function was not, so 488ea46e2
   shipped a red suite. That is the rule in CLAUDE.md, verbatim, about committing before mutating —
   and I quoted it to myself earlier today before doing exactly the thing it names.
2. MY OWN SCOPE TEST WAS VACUOUS. The mutant "report every skipped workspace as measured" survived,
   because I had asserted the split was CONSISTENT — no overlap, counts add up — and
   `measured: everything, skipped: []` is perfectly consistent. I wrote a test that could not fail,
   in the PR whose whole subject is things passing for the wrong reason. The split is a pure
   function now and the fixture carries a workspace with no test script. The mutant dies.

Six mutants, all killed now: root kept · selection by name only · by directory only · target ignored ·
a workspace reporting no files accepted · skipped reported as measured.

ONE THING THE RUN TAUGHT ME THAT I WOULD NOT HAVE PREDICTED: pnpm prints
`[WARN] Unsupported engine: wanted: {"node":"^24.13.1"}` ahead of the payload, so reading the report
from stdout would have sliced from the brace INSIDE that warning — the exact breaking input my own
comment called hypothetical in #26. The gate reads `--outputFile` now, which removes the class
instead of widening a tolerance.

2oh is PR #27, parked behind this per your order.
