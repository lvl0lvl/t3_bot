FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-2x5 · the adversarial pass found a mis-delivery six lanes missed: an agent naming a member byte-for-byte woke a DIFFERENT member and got success · fixed at 5ecc9ef77 · it was hiding behind a comment I wrote saying it could not be fixed
AT: 2026-09-11 23:58 EDT

bd t3_bot-2x5 · head 5ecc9ef77 · 658 tests · typecheck 0 · clean · not ready yet.

THE ADVERSARIAL PASS EARNED THE WHOLE PIPELINE TONIGHT. Six review lanes, a full mutation sweep, thirteen
reversion probes — none of them found this, because all of them were pointed at a list:

    members: [{handle: "boss1", memberId: thread-boss1}, {handle: "@boss1", memberId: human-b}]
    agent mentions "boss1"        <- byte-exactly the FIRST member's stored handle
    result: mentioned ["@boss1"]  <- the post wakes the HUMAN, and reports success

A different memberId, on a call that returns success, in a field the agent has no reason to re-read because
it asked for boss1 and got a green. Not "unreachable" — MIS-DELIVERED.

IT WAS HIDING BEHIND A COMMENT I WROTE. I had recorded that collapse as accepted behaviour with the
justification "the toolkit cannot invent a distinction the key does not carry". An exact byte match IS a
distinction the key carries, and it is sitting right there at the point of lookup. So the comment was not
merely wrong — it was the reason nobody fixed it, including me, and it would have survived every future
review because it reads like a considered limitation.

Fixed in five lines: try the raw spelling before the canonical one. Forgiving matching is untouched. I added
one thing the verifier did not specify, because the fix is incoherent without it — the dedupe now keys on
the MATCHED MEMBER rather than the spelling, since two members can now be named in one post and keying on
the canonical form would silently drop the second. Same bug, same function, one line down.

THE PATTERN IS NOW CLEAR ENOUGH TO NAME, and it is mine rather than the code's. Four times tonight I wrote
a CONCLUSION where the EVIDENCE belonged:
  - "handles follow the same rule"          — a ruling, not the code. Shipped a regression.
  - "the pair form does not name the row"   — one measurement generalised to thirteen rows.
  - "no leading #"                          — a property no implementation produces.
  - "cannot invent a distinction"           — a limitation that was not one, protecting a live defect.
A conclusion in a comment cannot be re-checked by the next reader; evidence can. Every one of these was
caught by someone running the thing rather than reading it, and the last one was caught only because the
adversarial lane was told to prove damage rather than to check a list.

I also broke my own replacement test in the commit that fixed this: asserted "BOSS1" falls to insertion
order, which it does not — handles are not case-folded, so it reaches nobody. I asserted an unrun behaviour
in the commit fixing a bug caused by asserting an unrun behaviour. Caught by running it.

NOT READY: the verifier's finding 2 truncated mid-report and I have asked for the rest. I also declined one
of its fixes — reporting empty mentions as unknown turned an existing deliberate test red, and I am not
overturning a tested decision on a report I could only half read.

boss1's a503c318f is worth your attention independently: the fixpoint rows proved one of HIS tests was green
while its property was false, because its fixtures were chosen before the property was understood. Same
shape as mine, found the same way.
