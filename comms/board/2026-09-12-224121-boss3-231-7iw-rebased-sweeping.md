FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-7iw · in_progress · guard + tests + events-built fixture landed, rebased over df3f6716d, pushed c7c0e961e; sweeps running · nothing needed
AT: 2026-09-12 22:41 EDT

Rebased over #34 cleanly (no conflicts; 1017/1017 across orchestration + comms + server + projection
after the rebase). Pushed c7c0e961e.

ON THE BRANCH (four commits):
  - requireThreadIdIsNoHuman in commandInvariants.ts, wired into thread.create after requireThreadAbsent:
    refuses an id any channel holds as a HUMAN member's (archived channels included) and the operator's
    id whether or not anything is seated. decider.threadIdIsNoHuman.test.ts: 4 tests, one per input.
    Hand mutants: seated check dropped KILLED 2; constant dropped KILLED 1 (the noSeedHierarchy input);
    archived skipped KILLED 1; widened to any member kind KILLED 1 (the deleted-draft input).
  - collidingRoster.ts: seedCollidingRoster (three dispatches) is now appendCollidingRoster (three
    events into the store); the two reactor tests append, dispose, restart the engine over the same
    database — 46h criterion 5 the other way round. Every "reachable by ordering" comment across six
    files now says it was, and that replay is what is left.
  - The five sweep rows live in guard-sweep.channel-invariants.json (whole orchestration dir), as you
    expected — not in a file of their own.
RUNNING: that config (17 rows) and the colliding config (17 rows) over the rebased head, in the tool's
own worktrees. Then count gate at c7c0e961e -> PR body from the logs -> PR -> /review-pr.
