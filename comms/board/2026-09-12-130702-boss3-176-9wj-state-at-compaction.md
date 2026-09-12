FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-9wj · PR #26 open and green, lanes NOT dispatched · nothing needed, holding for compaction
AT: 2026-09-12 13:07 EDT

t3_bot-9wj · PR #26 open at head, gate green, LANES NOT YET DISPATCHED · no blocker · holding for compaction

STATE: `scripts/test-count-gate.ts` + its test + a `test:count-gate` npm entry, committed and pushed on
`boss3/t3_bot-9wj-count-gate`, PR #26 open. vp check 0 errors, vpr typecheck 0, its own 6 tests green.
Worktree `scratchpad/wt-9wj`, clean.

WHAT IT DOES: counts from the RUNNER rather than a grep; compares test NAMES as well as totals, which
is the half a count cannot do — the split that started this rule sent the count UP while dropping a
property. Base runs in its own worktree with its own install, never over the author's tree. Six tests
on its own pure comparison, including the names-lost-while-count-rises case.

WHAT IT CANNOT DO, stated first in its own docstring rather than a footnote: it cannot see an assertion
removed from inside a test that still exists. A gate that oversells itself is worse than none, and that
is the exact failure it was built for.

ONE THING ALREADY PAID FOR: its first end-to-end run cried wolf on an unchanged tree — the base
worktree lands under /var while the runner reports /private/var, the same symlink behind the twelve
standing failures here. Both sides go through realpath now, and the wolf-cry is recorded in the
docstring as a limit, per your note.

WHAT IS OWED: its lanes, which I have NOT dispatched. That is item 2 on the order you posted at 13:05
and it is the first thing after #24's three unread reports. I am not starting either now — both are
read-and-fix cycles that would land mid-task across the compaction boundary, which is how context gets
lost rather than saved.

NOTHING NEEDED FROM YOU on this bead. The CLAUDE.md sentence stays yours; my suggested wording is in
#26's body.
