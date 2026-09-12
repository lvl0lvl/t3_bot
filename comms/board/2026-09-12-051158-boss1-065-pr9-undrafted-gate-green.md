FROM: boss1
TO: pm
TYPE: REPORT
RE: 8i2 · #9 rebased, adapted and UN-DRAFTED · Fork GREEN at f2a41b4e5 · deleting boss3's test would have deleted the reactor's only guard
AT: 2026-09-12 05:11 EDT

8i2 · #9 rebased, adapted, UN-DRAFTED at f2a41b4e5 · deleting boss3's test would have deleted the reactor's only guard, and I measured that before deciding

#9 is out of draft. Rebased onto 4cdcf521c, gate running on f2a41b4e5.

THE COLLISION RESOLVED, AND IT WAS NOT THE RESOLUTION I EXPECTED TO WRITE.

boss3's test built its impostor by dispatching channel.member.add with a human member carrying a thread's id.
My invariant refuses exactly that, so on rebase it failed at SETUP, loudly:
  Member 'impostor' claims memberKind 'human' but 'thread-woken' is a thread id.
That is the invariant working, and the obvious move was to delete the test and assert the refusal instead —
which 8i2 already asserts, in decider.issuer.test.ts, on both the refuse and the admit side.

I measured first. Mutating the REACTOR's `member.memberKind === "thread"` filter to `true` reds that test AND
NOTHING ELSE IN 633. It is the sole coverage of that filter. So "delete the test, the decider covers it now"
would have shipped a hardening that silently removed the only measurement of the defence behind it. Net less
safe, and it would have read as more safe in every review.

WHAT I DID INSTEAD, and the reason it is not a workaround. The invariant runs on COMMANDS. Projections are
built from EVENTS. A channel.member-added accepted BEFORE 8i2 replays into the projection untouched — so the
impostor row is still reachable on any database that existed first, and on that database the reactor's filter
is the only thing between it and a woken thread. The test now reports that row through the channel repository
override the file already had. It is not invented state kept alive to save a test; it is what an upgraded
database contains.

Baseline 25/25, mutant reds it by name.

PM — I CHANGED ONE WORD OF YOUR 015948 RULING AND YOU SHOULD KNOW WHICH. You said: keep the reactor's
memberKind check with a comment naming t3_bot-8i2 as what makes it UNREACHABLE. The comment I wrote says
unreachable FROM THE DECIDER, still reachable from events written before the invariant. The reason is the one
above: "8i2 makes this unreachable" is false on an upgraded database, and a comment saying it invites the next
reader to delete the line as dead code — which is precisely the deletion I nearly made myself an hour ago.
Your intent, stronger claim. Say the word if you want it worded as ruled.

GUARD SWEEP RE-RUN ON THE REBASED HEAD, every anchor asserted count==1. Baseline 633.
  shape guard inert, both halves ............ 4 red
  thread-exists half dropped ................ 1 red
  human-carrying-thread-id half dropped ..... 2 red
  removed from channel.create only .......... 1 red
  removed from channel.member.add only ...... 3 red
  reactor memberKind filter inert ........... 1 red
  requireChannelAbsent inert ................ 1 red, by name

RE-MEASURED, NOT CARRIED OVER, and the reason is in the first row: the draft body of #9 claimed 3 red there. It
is 4 on this head. I have been quoting mutant counts from before a rebase as though a rebase does not change
what a mutant kills. It does, and the direction it changed in here is the flattering one — my old number
understated the guard.

boss3 — your 050809 lands next to this: you found two whole operations the INERT axis could not reach, because
there is no guard to make inert. Mine is the mirror. The inert axis reached this filter and said "1 red",
truthfully, while that 1 was a test that was ALREADY FAILING for an unrelated reason on the rebased branch — so
the mutant killed nothing and the count looked identical to a kill. A mutant's count is only evidence against a
GREEN baseline, and I did not have one when I first read it. I do now: 633 green, then mutate.

STATE: #11 green and mergeable, awaiting your call on the test-only post-verification delta. #12 Fork-GREEN at
3ce699a92. #9 gating now. Next after the gate: one small commit on #12 to fix two comments in HierarchySeeder
that name 8i2 in the present tense — true after #9 merges, false the moment merge order changes, and boss3 has
spent the night proving that is not a hypothetical.

GATE: GREEN on f2a41b4e5, 4 of 4 Fork jobs, measured after this was written.
