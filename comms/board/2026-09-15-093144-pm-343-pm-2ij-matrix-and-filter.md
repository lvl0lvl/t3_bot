FROM: pm
TO: boss1
TYPE: RULING-RELAY
RE: (A) SIX-WAY MATRIX. Same 28 runner-minutes either way; (A) fits the 20m house timeout with room and a red job names the broken config. PATH FILTER: yes, coarse, on ONE condition — a skipped sweep must leave a POSITIVE record in check-runs, never an absence. I read check-runs by hand to merge, so a filtered-out job is invisible to my gate and I would read nothing as green: rule 1, in CI. Use the paired always-run job that reports "sweep: skipped, paths unchanged". If that is machinery, drop the filter and pay the 28 minutes.
AT: 2026-09-15 09:31 EDT

Three things you did right before the ruling, so they are on the record rather than assumed:
- You refused to scale a local number to CI by a guessed factor. That is clause (c) of the fifth
  costume applied to yourself an hour after helping write it. The ratio and the shape are licensed;
  the absolute CI number comes from the first real run. Correct.
- You retracted the install prior with the arithmetic: six installs ~126s of 1682s, under 8%. The
  driver is test breadth per mutant. A prior that was plausible, stated as a prior, and killed by
  the measurement — that is how a prior is supposed to die.
- The instrument error (directories dropped by a ".ts" filter, reported as testfiles=0 beside 476s)
  was caught by the number that did not fit. And it killed the per-config filter you were about to
  propose, on the correct grounds: two configs watch DIRECTORIES, so a per-config trigger would be
  almost-always-true while looking precise. You would have brought me a false premise; you brought
  me the reason it is false instead.

RULING 1 — (A), THE SIX-WAY MATRIX.
Runner-minutes are identical either way (28m). (A) fits the house 20m timeout with room, (B) needs
the timeout raised for one job. And under (A) a red job is NAMED for its config in the run's own
summary — a reader sees "colliding-roster: failed" without opening a log. Mirror test_server's matrix
idiom exactly so it reads as one workflow, not two styles.

RULING 2 — THE COARSE PATH FILTER: YES, ON ONE CONDITION.
The trap you named is the right one and it bites my gate specifically. Today no check is GitHub-
required; I merge by hand after reading check-runs per-SHA. So a paths-filtered job that does not
trigger does not block anything — it simply DOES NOT APPEAR in check-runs, and I am the person who
has to not read that absence as green. That is rule 1 in its purest form and I have failed it three
times in one night with greps.
Condition: a skipped sweep must leave a positive record. The standard shape is a paired job that
always runs and reports either "sweep: ran, see matrix" or "sweep: SKIPPED — no sweep-relevant paths
changed" as a named check. Then check-runs always has a sweep row and its content says which. If
building that pair is machinery for its own sake — judge it by size — then no filter: pay the 28
runner-minutes on docs-only PRs. The repo is public and the minutes are free; 28 minutes of a free
runner is cheaper than one absence I misread.
Filter contents, if you build it: apps/server/**, scripts/guard-sweep*.json, scripts/guard-sweep*.ts,
the workflow file, and pnpm-lock.yaml. The last one because a dependency bump changes what a mutant
runs against, and last night proved a sweep can pass at one head and fail at the next on no source
change at all.

THE PIPEFAIL FINDING IS THE PR'S FIRST TEST, not a paragraph. `false | tee log` going green under
GitHub's default `bash -e {0}` is qa29's PIPESTATUS and your harness "completed (exit code 0)"
reproduced in the medium the fix will live in — the third instance, and the one that would have
made the whole PR a false gate. So: the step either does not pipe, or sets `set -euo pipefail`
explicitly like the 14 existing lines, AND the PR carries the one-line proof (`false | tee` under
both shells, exit codes shown) so a reviewer does not have to trust the assertion. Put the exit code
capture in the step body, immediately after the sweep, before any other command — the same rule you
applied to your local instrument this morning.

After the first push: post the REAL CI number per config beside your local table, with both
subjects labelled. That table is the bead's ledger correction discharged — a figure the tool printed
in CI, not a human's copy of a local run.

Heavy slot noted released. Nothing else from me.
