FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-zuy · #20 at b4cbd1b31, pushed, tree clean — compaction checkpoint · triage ruled 44/44 with ZERO hallucinated: 21 legitimate, 17 already fixed, 4 not-actionable, 1 decision, 1 deferred · ALL THREE MERGE-BLOCKERS CLOSED (post id, read order, send outcome) · 14 fixes landed this round · last: the mention boundary is now Unicode categories — the ASCII range list let an em-dash or a curly quote run INTO the handle, and macOS substitutes em-dash for -- as you type, so 'over to @boss1—he' refused the whole post · plus four more false comments of mine corrected, including a stale test count that now cites no number at all · remaining legitimate findings are the N+1 query, the 32-mention cap, three p1/p2 design items, four naming/convention items, and HIST-20-01 which belongs on my #19 · state written to scratchpad/HANDOFF.md · SEC-20-01 still the only ruling I need and it does not block
AT: 2026-09-12 10:34 EDT

COMPACTION CHECKPOINT. Everything committed and pushed; local == remote; tree clean. Full state in
scratchpad/HANDOFF.md so nothing depends on my memory surviving.

#20 IS AT b4cbd1b31. Gate: vp check 0, vpr typecheck 0, and 1988 tests green across server.test.ts +
client-runtime + contracts. The FULL-suite numbers in the PR body were measured at 493baad30 and need
re-running before that table is accurate again — I would rather flag that than let a stale table read
as current.

TRIAGE IS IN: 44/44 ruled, ZERO HALLUCINATED. 21 legitimate, 17 already fixed, 4 not-actionable, 1
decision, 1 deferred. All three merge-blockers closed.

It also settled two things I had flagged for you. The disputed pair resolves AGAINST SEC-20-02 —
dropping an invisible-character handle silently is the defect the boundary fix removed, so its
suggested fix was harmful and I was right to refuse it. And SEC-20-01 is DECISION rather than
legitimate: triage verified the DECIDING CLAIM rather than my reasoning — a replayable resume really
does send no snapshot, so a delivered-ids set really would suppress genuine removals. That ruling now
rests on executed evidence instead of my argument for it.

THE LAST FIX IS THE ONE WORTH KNOWING. My single-set mention boundary was still an ASCII range list,
so an em-dash or a curly quote ran INTO the handle: "over to @boss1—he" produced the handle "boss1—he"
and the decider refused the whole post. macOS substitutes an em-dash for "--" AS YOU TYPE, and this
repo's own copy uses curly quotes — so both arrive without anyone trying. Unicode categories now, with
\p{So} deliberately EXCLUDED from the boundary because emoji live there and channelIdentity records
refusing emoji handles as a regression it had to undo. 25 cases probed before the change went near the
source.

FOUR MORE FALSE COMMENTS OF MINE, corrected in the same pass. The one I would point at: a comment
citing "all 185 green" for a mutation measurement. The substance held — the named mutant still reds
the named test — but the FIGURE was stale twice over, and a reader re-running it could not tell a
grown test population from a surviving mutant. It now names the mutant and the single test it reds and
CITES NO NUMBER AT ALL, which is the general fix: an absolute count in a comment is a claim that
decays.

FIVE TIMES TODAY AN INSTRUMENT TOLD ME A TRUE FACT ABOUT THE WRONG SUBJECT: $? after a pipe measuring
tail; a mutant "dying" having executed no tests; git status --porcelain unable to see a gitignored
write; `cd apps/web && npx tsc` reporting 0 errors on a file vpr typecheck failed; and a whole-file
grep matching a docstring that explained why a thing was absent. That is the pattern I would want the
next session to carry, and it is in HANDOFF.md.

REMAINING LEGITIMATE, none blocking: the N+1 members query (two lanes; the only caller discards every
member the join fetches), the 32-mention cap, three p1/p2 design items, four naming and convention
items, and HIST-20-01 — my own #19 adds a second constant for this same value and rewrites the same
two ws.ts lines, which I am handling on #19 rather than folding in here.

NOT ASKING FOR A MERGE. SEC-20-01 remains the only ruling I need and it does not block the rest.
