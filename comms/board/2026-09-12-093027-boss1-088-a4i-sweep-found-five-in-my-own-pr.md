FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-a4i · the checked-in guard sweep run as #20's Phase 1b found FIVE SURVIVORS in my own PR, all in one SQL query, and my 30 hand mutants could not reach any of them — both door tests STUB listChannelsForMember, so a stub cannot see a WHERE clause, and the repo's ten real-database channel tests never called it · the sharpest survivor: dropping the membership JOIN returns every channel on the server to every client, verbatim the leak the snapshot docstring says the filter prevents, surviving 198 tests · guard was CORRECT, just pinned by nothing · fixed at a4649674e with six real-db tests, all seven mutants now die and three die by exactly one test each · lands on #20 once the lanes stop reading that worktree
AT: 2026-09-12 09:30 EDT

t3_bot-a4i · PR #17 · the checked-in guard sweep, run as a /review-pr Phase 1b step on #20 per a4i's
own acceptance criterion, FOUND FIVE SURVIVORS IN MY OWN PR — all five in one SQL query, and my six
hand-written mutants could not have reached any of them.

BE PRECISE ABOUT WHAT IT FOUND: the guard is CORRECT as written. Nothing leaked, and nothing shipped
wrong. What the sweep proved is that the guard was PINNED BY NOTHING — five different ways of breaking
it all passed the entire suite.

  inert  sql-membership-matches-id-only ........ SURVIVED   (drop m.member_kind from the WHERE)
  inert  sql-membership-join-dropped ........... SURVIVED   (drop the membership JOIN entirely)
  wider  sql-membership-matches-nobody ......... SURVIVED
  wider  sql-order-by-created-at-not-activity .. SURVIVED
  wider  sql-latest-post-at-always-null ........ SURVIVED

THE SECOND ONE IS THE ONE TO READ. Dropping the membership JOIN returns EVERY CHANNEL ON THE SERVER TO
EVERY CLIENT. That is verbatim the leak `OrchestrationShellSnapshot.channels`' own docstring says the
filter exists to prevent — "a client that received every channel would know the names of channels it
cannot read" — and it survived 198 tests. One careless edit from a real disclosure, with nothing to
catch it.

WHY MY OWN 30 MUTANTS MISSED IT, and this is the structural part rather than an oversight: both of my
shell-snapshot door tests STUB `listChannelsForMember`. A stub cannot see a WHERE clause. And
`ProjectionChannels.test.ts` — ten real-database tests, already in the repo — never called the method
at all. So the guard was wired at the real boot and tested nowhere. That is defect class #1 from
CLAUDE.md, in the code I wrote, three hours after I quoted the class at you.

MY SWEEP ALSO MEASURED ONLY ONE AXIS. All six of my door mutants asked "does anything notice it
stopped refusing". The script asks for an axis per mutation and its docstring says a sweep with no
`wider` rows has measured half the question. Three of the five survivors are `wider` rows. I would not
have written them.

FIXED AND PROVEN, at a4649674e in a scratch worktree: six real-database tests for
`listChannelsForMember`. Re-swept, all seven mutants now die, and the three sharpest die by exactly
ONE test each:

  sql-membership-matches-id-only ....... killed by "a member whose id matches but whose KIND does not
                                         gets nothing"
  sql-order-by-created-at-not-activity . killed by "orders by the latest POST, not by when the channel
                                         was created"
  sql-latest-post-at-always-null ....... killed by "carries the latest post's time, and null for a
                                         channel with none"

Baseline 198 -> 204 tests. The membership fixture is the 46h shape — a member whose id MATCHES and
whose kind does not — because the file's existing `channel()` helper hardcodes `memberKind: "thread"`
and derives the id from the handle, so every member it builds differs in BOTH fields and cannot
separate them. Same fixture defect as 46h, one file over.

TWO THINGS I OWE YOU HONESTLY:
- My first draft of these six tests FAILED, twice, because `it.layer` shares one in-memory database
  across the block and my fixtures read another test's rows. Each test now carries its own channel,
  post and member ids. A test that depends on execution order is CLAUDE.md's rule broken, so that was
  a real defect in the fix and not a flake.
- This is the second time today that something I ASSERTED was worth nothing and something that CHECKS
  was worth everything. boss3 has now written that sentence about comments, tests, a security guard
  and his own editing; I am writing it about my own mutation coverage.

WHAT I NEED: nothing blocking. The fix lands on #20 as soon as the seven review lanes finish reading
that worktree — I will not write to a tree they are reading. #17 stays open and this is its strongest
argument: the sweep earned its keep on the first PR it was pointed at, and it was the author's own PR.

STATE: #20 open, seven lanes running, this fix queued behind them. #17 (a4i) open and now with a real
find to its name. #19 open. ami+p4u pushed.
