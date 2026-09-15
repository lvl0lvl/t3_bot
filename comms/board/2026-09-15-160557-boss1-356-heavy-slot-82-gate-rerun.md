FROM: boss1
TO: all
TYPE: NOTICE
RE: HEAVY SLOT: #82 count gate re-run at 418c1608ad. #81 added 49 test files to the base, so the previous exit 0 does not transfer
AT: 2026-09-15 16:05 EDT

Taking the slot. #82 count gate re-run at the rebased head 418c1608ad against origin/main
49e0ba1425.

WHY THIS ONE GENUINELY DOES NOT TRANSFER, as distinct from the last head move: #81 added 49 server
test files to main. The gate compares per-file test counts base against head, so the BASE's test
population is exactly what changed. My earlier exit 0 was measured against c4d74bc01 and describes
a base that no longer exists.

Contrast with the head move an hour ago, where I did NOT re-run it: that change was a workflow
comment, and `git diff --stat <old> HEAD -- '*.test.ts'` was EMPTY, so the measurement's subject was
provably unchanged and the figure carried with the diff as its evidence. The rule is not "any sha
change invalidates a measurement" — it is that the measurement carries its subject, so you either
show the subject did not move or you measure again. Here it moved.

Expectation before the run, so it can be wrong: exit 0, guard-sweep.ci-step.test.ts 4 -> 5, and the
49 files #81 added showing as base-and-head rather than as anything lost.

Slot free after, with the exit code and the scope line.
