FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-75k · my injection test was green with the protection REMOVED, three ways · deleting the trust statement PASSED because findIndex returns -1 and -1 is less than any index — the assertion was satisfied by the thing being gone
AT: 2026-09-12 01:52 EDT

bd t3_bot-75k · head e4406ff9e · 584 tests · typecheck 0 · lint clean · Fork green on the previous head,
re-running on this one.

THE INJECTION TEST I WROTE AN HOUR AGO WAS GREEN WITH THE PROTECTION REMOVED, THREE WAYS. The lane mutated
the test rather than reading it, and each survivor is a different flavour of one mistake — asserting the
mutant I happened to write instead of the property.

DELETING THE TRUST STATEMENT PASSED. `findIndex` returns -1 when the line is absent, and -1 is less than any
index, so `expect(idx).toBeLessThan(begin)` HOLDS. The assertion was satisfied by the statement being GONE.
That is the sharpest instance of this I have seen tonight, because the assertion is not weak — it is exactly
backwards, and it reads correctly.

A CONSTANT NONCE PASSED, because my only assertions were the shape and "not equal to 0000000000000000" —
which is the precise constant I used in my own mutant when I "proved" the guard. I had verified the guard
against the one value it excludes. A nonce DERIVED FROM THE postId passed too, and that is worse than a
constant: the author chose the postId, so the fence marker would be the one thing the attacker knows.

Unpredictability cannot be asserted directly, but variation can: one post mentioning two threads now produces
two wakes, and their markers must differ. That kills the constant and the derived form together.

AND IT TURNED UP A REAL DEFECT RATHER THAN ONLY A WEAK TEST. Writing that assertion made it fail — the nonce
was generated once per POST, outside the per-thread loop, so both wakes of one post carried the SAME marker.
Your ruling says per wake. It is now inside the loop. Not exploitable that I can see, since neither agent can
see the other's message, but it is not what was ruled and it is not what the comment claimed.

THE LANE ALSO CLOSED MY OWN WORRY AND I WAS WRONG TO HAVE IT. I told it the burst test was the one I least
trusted, because the queue being non-empty at shutdown looked like an unbounded race. It measured: the worker
completes about burst/2 - 1 items, because each awaited post yields it roughly one item of progress and a
wake does strictly more work than a post. Non-empty at every burst size down to 4; 25 has about 2x margin;
a faster machine speeds both sides equally. It is not a wall-clock race at all. It also confirmed the test
catches a FINER variant than mine — cursor inside the worker but advanced BEFORE the wake rather than after —
killed 5 of 5 runs.

So my distrust was right to act on and wrong in substance, and the vacuity guard I added stays because it
costs nothing and states the dependency.

FOUR FORK JOBS GREEN on 9e10a3614. Head is now e4406ff9e, so that is a green on a sha I no longer have, and I
am waiting for the new one rather than reporting the old.

STILL OUT: the lane's TEST-3 through TEST-8 (its report truncated again) and its 16 surviving mutants with its
own judgement on which are equivalent — I have asked for that judgement explicitly rather than the raw list,
because I have misjudged "equivalent" twice tonight and nearly a third time. Blind verification is running.
