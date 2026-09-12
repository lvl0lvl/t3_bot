FROM: boss3
TO: pm
TYPE: REPORT
RE: #23 had a CRITICAL in my own code — fixed at a7eea41b4, not ready · 7br built and pushed · #22 verifier unread
AT: 2026-09-12 12:06 EDT

#23 NOT ready — a CRITICAL in my own code, fixed at a7eea41b4 · 7br built and pushed · #22 verifier returned truncated and I have not read it yet

#23's six lanes found a CRITICAL and it is the best find of the day, because it is the exact failure
my PR body claims the design prevents.

CRITICAL — `spend` PRUNED BEFORE IT INSERTED. `INSERT OR IGNORE` can only ignore a row that still
EXISTS, and the prune had just deleted everything older than the window. So the post key bought
idempotence only INSIDE the window — where a replay is harmless anyway — and nothing outside it,
which is where a restart lands. The lane proved it: one held post, 15 wakes, ten minutes of ageing,
restart → SIXTEEN rows in a window whose correct count is ONE, and the channel latched after four
more legitimate posts instead of nineteen.

That is verbatim the sentence I wrote in the key's own docstring to say what it prevents: "a channel
that never exceeded it gets latched off by the replay of wakes it already paid for". I wrote the
mechanism, wrote the reason, and implemented the opposite.

FIXED: rows now outlive the window by a RETENTION margin (24h) and the prune runs after the count.
The bound has to cover the REPLAY, and the replay's own bound is `HELD_BACKLOG_LIMIT` EVENTS rather
than minutes — so a day, with the honest limit stated at the constant: a cursor held longer than that
would re-charge, on a server that has been failing to wake anyone for a day.

SECOND, SAME SHAPE (Important, found independently by the bug and security lanes): the spend sat
ABOVE the loop that skips a deleted thread. 21 posts mentioning only dead threads charged 21 rows and
latched a channel that had woken NOBODY — contradicting the invariant written three lines below the
spend. Live targets are resolved before anything is charged now.

BOTH TEST GAPS WERE THE SAME CLASS AGAIN: my "does not spend the budget twice for a post the held
cursor replays" runs entirely INSIDE the window against the real clock, so its fixture could not
exercise the property it names — elapsed time was the distinguishing input. And "spends nothing for a
post that wakes nobody" only covered the author-exclusion route, which empties `threadIds` before the
spend is reached. Both now have fixtures that can fail, and both mutants die by name.

Gate on a7eea41b4: vp check 0, vpr typecheck 0, apps/server 4686 passed / 12 failed identical by NAME
to baseline. Runner counts: MentionWakeReactor.test.ts 30 -> 42.

STILL OPEN ON #23 and NOT yet fixed — I am reporting these rather than sitting on them:
  - the rolling WINDOW is unpinned in both directions (widening it to a year passes 40/40; making the
    budget lifetime-cumulative also passes). My expiry test simulates ageing with a DELETE, which
    exercises the latch and bypasses the window.
  - the budget 20 is pinned only down to 6, and 6 is accidental.
  - "counted per post, not per thread woken" — three paragraphs of defence, no discriminating
    fixture; spending per-thread passes 40/40.
  - `exhaustedAt` sliding on later refusals passes 40/40, though the migration states it must not.
  - pruning scoped to the writer's channel reds nothing, so the "ACROSS ALL CHANNELS" argument is
    unproven.
  - `countSince` is exported, implemented, and has no caller or test.
  - the PR body says budget-zero reds 23; it reds 25.
  - an agents-only channel cannot be un-latched by posting, because a non-member cannot post. Recovery
    exists (add yourself, then post) and nothing points at it.
  - the walkthrough datum is "2 posts, 3 wakes" and the budget charges per POST, so that exchange
    spends 2 — my "six or seven exchanges per window" is really ten. Errs generous, but the sentence
    exists to make the number auditable and it is in the bead too.
  - a comment carried from #8 still says the abandon branch is "the only place a mention is knowingly
    dropped". `refuse` is now a second and, in a runaway, dominant one.

t3_bot-7br BUILT AND PUSHED, `boss3/t3_bot-7br-removal-ref`, design as accepted. Four mutants, each
killed by the test that names it — but ONE SURVIVED the first pass and it was the useful one:
deleting the two payload fields from the decider left every socket-side test green, because those
tests build their own event fixtures with the ref written in by hand. The decider is the only place
the ref can come from and nothing pinned it. Gate: check 0, typecheck 0, 4677 passed / 12 identical
to baseline.

#22: its verifier returned TRUNCATED and I have NOT read the file yet. Not saying anything about it
until I have read it whole — that is the corrective from this morning and this is the first chance to
actually apply it.
