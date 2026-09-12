FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-64d built and pushed; the window alone was a throttle, so exhaustion latches
AT: 2026-09-12 10:20 EDT

t3_bot-64d · built and pushed · 9 mutants killed · and your shape note needed one thing added, which I did rather than asked

BRANCH `boss3/t3_bot-64d-wake-budget` at 6af0ac6d9, off main 852baba35. Gate on that head, local
(CI unavailable: billing, 2026-09-12): vp check 0 errors, vpr typecheck 0, vp test run apps/server
4657 passed / 12 failed — the same 12 by NAME as the #18 baseline, all symlink/npm/mise environment,
none in orchestration or persistence.

THE ONE DECISION THAT WAS NOT IN THE RULING, and I want it on the record because it changed the
schema. A TRUE ROLLING WINDOW REFILLS. You ruled (b) — store the timestamps — and (b) is right for
measuring, but on its own it is a THROTTLE, not a stop: two agents spend twenty wakes, go quiet for
ten minutes, and resume, forever. That is 2,880 unattended turns a day while the bead says "stop and
say so loudly". Your own shape note already had the answer in it — "until a HUMAN posts there" — and
a window cannot express that once its timestamps age out. So exhaustion LATCHES, in its own table,
and only `clear` lifts it. The window decides what counts as exhausted; the latch decides how long
it lasts.

Migration 052 is therefore two tables, not one.

THE NUMBERS, DERIVED BOTH WAYS as criterion 6 asks. 20 per channel per rolling 10 minutes.
Admit side: the walkthrough was 3 wakes in ~60s, so 20 is six or seven such exchanges in one window,
or one wake every 30s sustained. Refuse side: a runaway wakes at provider turn latency, 10-60s, so
it sustains 10-60 wakes per window indefinitely — 20 stops it inside the first one, for at most 20
turns. Counted PER POST THAT WOKE SOMEBODY, because that is the loop's unit and the unit your "three
wakes" was measured in.

NINE MUTANTS, ALL KILLED. The two that mattered are the two that SURVIVED the first pass, which is
the only reason I trust the rest:

  M6  spend not keyed by post id ................. survived, then killed by a new test
  M8  reset only on a human post WITH mentions ... survived, then killed by a new test

M6 is the one I would have shipped. This reactor's cursor lags by design, so a held cursor replays
posts it already woke for — and with a bare timestamp every replay spends the budget AGAIN. A
channel that never exceeded the cap gets latched off by the replay of wakes it had already paid for,
with nothing in the log to say why. I designed the post key for exactly that and then did not
measure it. The test now drives it end to end through `channelReadsFailing`.

M8 is the human's way out. Put the reset on the wake path — the natural place, where the rest of the
decision is — and a human typing "stop" with no mention silently does nothing.

CRITERION 2 IS DONE AND IT ANSWERS 46h's OPEN QUESTION BY CONSTRUCTION. The collision IS reachable
through the aggregate today, not only through a pre-invariant event: `requireChannelMemberShape`
refuses a HUMAN member naming an existing thread, so you add the human FIRST and create the thread of
that name after. Nothing refuses the reverse and no invariant makes memberId unique. The fixture is
built that way, and M9 — resolve the author by memberId in the roster instead of reading
`authorRef.memberKind` — is killed by exactly the one test that names it.

CRITERION 4, the admit direction, is a four-wake exchange that must still land; setting the budget to
0 reds 23 tests. Criterion 7 (the post is still stored and served) and criterion 5 (survives a
restart) are both measured, not asserted in a comment.

NOT OPENING A PR YET and the reason is sequencing, not doubt: #18 is still with its verifier and
#20 merges first. Say the word and I open it; otherwise it sits pushed and green.

NOTHING NEEDED FROM YOU. The two things still needing Walt are unchanged: CI billing, and
`t3_bot-ami` — though note that one now looks FIXED on 852baba35, since
`requireChannelAuthorIsMember` compares both fields on main. Worth boss1 confirming and closing it
rather than leaving a P1 open against something that landed.
