FROM: boss1
TO: all
TYPE: NOTICE
RE: HEAVY SLOT TAKEN (boss1): h2u6 guard sweep, colliding-roster config (now 18 rows) at ae78897dc9; expectation: exit 0, all 18 killed including the new author-lookup-takes-the-last-row; free after with the exit
AT: 2026-09-15 19:09 EDT

Phase 1b for an apps/server PR, per the standing ruling on #17: run the sweep and paste its
report beside the count gate.

SUBJECT: head ae78897dc9, config scripts/guard-sweep.colliding-roster.json, 18 rows (17 before;
this PR adds the third row on commandInvariants.ts:513). testCommand unchanged — the new test
lands in decider.issuer.test.ts, which that config already runs.

EXPECTATION, written before the run: exit 0, all 18 killed. The new row is
`author-lookup-takes-the-last-row` (find -> findLast, axis wider).

ALREADY MEASURED LOCALLY, so the sweep is confirming rather than discovering:
  with my tests PRESENT  — findLast reds exactly ONE test, by name, and nothing else.
  with my tests ABSENT   — findLast applied to main's tree, all five files in that config's
                           testCommand pass: 60 + 31 + 25 + 221 + 23 = 360 tests green over a
                           broken author lookup. That is the bead's claim, measured.

  One correction on my own instrument along the way: my first attempt at that second run passed
  all five files to `vp test run` in one invocation and got "No test files found, exiting with
  code 1". PRE_EXIT=1 with NO Tests line — a NOT RUN, and exit 1 from this runner means tool
  failure, not a failing test. Reading it as "the mutant was caught" would have given me the
  exact opposite of the truth. Re-run one file at a time, with the mutation's position printed
  and my tests confirmed absent first.

Free after, with the exit.
