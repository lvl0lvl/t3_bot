FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-j6o · 1tv's check, applied by hand, said 'rebase first' on my own branch — rebased onto 7200c98df, sweep + gate re-running at 2dcca0a7b · #21's mutants re-run: 4/4 die, each to MORE tests
AT: 2026-09-12 19:05 EDT

t3_bot-j6o · #33 rebased onto 7200c98df (post-#31), 184 tests green, gate and sweep re-running at 2dcca0a7b · nothing needed
t3_bot-1tv · #32 gate re-run measuring, base 22d694955 contained · nothing needed

1tv CAUGHT MY OWN BRANCH BEFORE THE TOOL SHIPPED. About to start j6o's gate, I ran the check #32 adds
— `git merge-base --is-ancestor origin/main HEAD` — by hand first. It said no: #28 and #31 had landed
since I forked. A run against `origin/main` would have measured a base holding tests my head never had
and listed them as LOST from #33. Rebased instead; clean over both. Migration 053 is still the only new
migration and its number is uncontested. 184 tests green at the new head, typecheck 0, pushed.

THAT INVALIDATES THE SWEEP ARTIFACT ALREADY IN #33's BODY — it names a37604ec8, which no longer exists.
Re-running at 2dcca0a7b so the table describes the head you would merge. The gate is running against
7200c98df by SHA. Three runs of mine on the machine at once; the sweep is in its own worktree and its
install is I/O while the gates' suites are CPU, so they are not fighting for the same thing.

#21's MUTANTS, RE-RUN ON THE j6o HEAD as the closing line asks. All four die, and each dies to MORE
tests than it did in #21:

  projector stops replacing the pending start      1 -> 1   (same test, still by row count)
  wake dispatches a messageId that is not the key  3 -> 6
  wakeKey drops the channel                        1 -> 5
  wakeKey drops the thread                         1 -> 6

That is the opposite of #27, where a format change moved fifteen fixtures PAST the guards they were
written for. Here the link table hangs off the same key, so a change to the format now reddens the
capture, the join and the parser as well as the reactor. It is in #33's body as a table, because it is
the direction a count cannot see and the one that matters.

Also checked, prompted by your #31 note about Effect.flip being the real discriminator: the j6o
end-to-end test discriminates on `toEqual` over the whole wake array, which the sweep proved kills the
outcome mapping, the drop, and the empty-array mutants at that door. Nothing to correct.

"PR ready #32" the moment its table lands; "PR ready #33" when both of its do.
