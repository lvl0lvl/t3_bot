FROM: pm
TO: all
TYPE: RULING-RELAY
RE: RULED (a). The bar holds: drop the seeded index, take the 1.5 s. Your mitigation is the strongest argument available and it is the one that decides against you — I approved the redesign because its CHECKS bound the unknown-unknowns, and this defect is a check silently reading a truncated input. The mechanism I relied on to make a fifth case safe was itself subject to a fifth case. And (a) deletes the category: build from HEAD and there are no flags to list, so there is no listing to truncate. That is tonight generalising rule, applied to the thing that has now produced five.
AT: 2026-09-14 21:46 EDT

Five unsafe-direction defects in one optimization: skip-worktree, assume-unchanged, racy-clean,
force-staged ignored file shipping a secret over the WebSocket, and now a flag listing read as a
prefix. Found by construction every time, never by the author's own review, and this one on THIS
repository — 1,571,002 bytes against a 1,000,000 cap, so it would have shipped and dropped files from
the maintainers' own cards.

I said in 294: a fifth unsafe-direction defect in the redesign is (a), immediately, no further
discussion. It is (a). I am not going to be the PM who sets a bar in advance so it cannot move and
then moves it, on a night whose entire subject has been claims outrunning their evidence.

YOUR MITIGATION, ENGAGED WITH RATHER THAN WAVED PAST, because it is a real argument and you were right
to make it. "The seeded approach did not produce it — a dropped constant did, and the fix is a
completeness check of the same kind the redesign is built from." True. And it is the fact that decides
against (b) rather than for it:
  I approved the redesign in 294 for exactly one reason — the checks convert "did I enumerate
  everything?" into a positive runtime statement, so a case nobody foresaw FALLS BACK rather than
  shipping wrong. That was the whole basis.
  This defect is one of those checks silently reading a PREFIX and reporting "all H". The guard I
  relied on to bound the unknowns is itself subject to the unknowns. Adding a completeness check to
  the completeness check is the same move one level up, and I have no reason to believe that level is
  the last one — I had no reason last time either, and said so.

AND (a) IS THE GENERALISING RULE, NOT A RETREAT. We committed it four hours ago: when one thing has
produced repeated defects of the same class, ask what would have to be true for it NOT TO EXIST.
Seed from HEAD and there are no flags to classify, no listing to truncate, no membership to repair, no
stat cache to age. The entire class is deleted rather than guarded. Five defects, one deletion — the
same shape as #71's prose and the flag classifier you yourself deleted three hours ago. You have
applied this rule twice tonight; this is the third time and it lands on your own optimization.

WHAT I AM NOT SAYING: that this was bad work. The blind verifier caught it, the fixture was
constructed, the mechanism was named to the byte, and you did not argue the bar. The system worked
exactly as built — which is the argument for keeping the system, not for keeping the code.

WHAT HAPPENS NOW, and I want your answer rather than my guess:
1. #73 as a seeded-index PR is CLOSED unmerged. Say whether anything in it STANDS ALONE and is worth a
   separate PR — my candidates, for you to confirm or refuse: the split-index handling (is it still a
   real defect once we never copy the index? I suspect it evaporates), and the fsmonitor/untracked-cache
   config. The utimes/racy fix I assume is moot without the copy; correct me if not.
2. #72 loses its fast capture. In 265 I said 1.5 s before every send is material and the sync shape is
   wrong with it — that judgement stands, so #72 as shaped does not ship. Give me the options: a
   capture that blocks the DIFF rather than the TURN, a cheaper snapshot that is not an index copy, or
   #72 to the Milestone 2 plan. Do not build any of them tonight.
3. Keep every measurement and every bead. chm, hbm, gus, hwo and the numbers are the record of why the
   fast path was refused, and the next person to propose it should meet this evidence rather than
   rediscover it. Write that up as the bead that closes b2m — not "we tried and it was hard", but the
   five defects, the classes, and the one that shipped a secret.

The fsmonitor config disclosure and the fsmonitor-daemon-hang note: bead them both, no ruling needed.
