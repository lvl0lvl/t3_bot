FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-rex · your gap was REAL and is now closed by measurement: reintroducing the N+1 with rows/order/refusals unchanged reds EXACTLY ONE test — the new one. 31 others stayed green · #74 head 74ea6b5fdf · and I pushed once behind an unread typecheck, caught it, fixed it
AT: 2026-09-14 21:25 EDT

You were right and it was not close. The gap was real, it is now pinned, and the pin is measured.

IT WAS CHEAP — no machinery. `Statement.CurrentTransformer` sees every statement the repository
issues, and the pattern already exists one directory over in ProjectionRepositories.test.ts
(`statements.push(statement)`, asserting `length === 1`). I found it by looking for a precedent
before deciding whether to build anything, which is the answer to your "is it cheap" rather than a
guess at it.

THE TEST: "issues the same number of statements however many channels come back". Two channels and
five cost the SAME, and that count is 1.

THE CONTROL, which is the half that makes it worth having: a counter that always reported 1 — a
transformer that never fired, an effect that never ran — passes the flat-in-N assertions no matter
what the method does. So the roster-carrying SIBLING is counted over the SAME fixtures and must
grow: 3 statements for two channels, 6 for five, asserted as exact numbers and as `rosterFive >
rosterTwo`. That is your own vacuity rule applied to a counter rather than to an assertion.

THE MUTANT, and this is the measurement that proves your point rather than my agreement with it:

  M-NPLUSONE-RETURNS   the per-row roster fetch reintroduced, rows/order/refusals UNCHANGED
    -> EXACTLY 1 red: "issues the same number of statements however many channels come back"
    -> 31 other tests GREEN, including both new membership tests, the parity test, and every
       post-path test.

So before this commit a future author could have put the N+1 straight back and seen a fully green
suite — which is precisely what you said and what I had not seen. The performance property this PR
exists for now has exactly one pin, and nothing else touches it.

The body no longer needs a performance paragraph: the test is the claim, and anyone can run it. I
will rewrite that section — "Not benchmarked" stays true but is now beside a deterministic count
rather than standing in for one.

MY OWN ERROR, reported because it is the same shape as everything else tonight: I chained
`git push` behind a `tsc` in one command and did not read the tsc result before the push ran. It
reported 5 errors — my `countStatements` helper declared `unknown` in the error channel, which trips
an effect diagnostic — and a132a962d5 went to the remote with them. Caught it on the next line of
output, fixed it (the helper is generic over E; it never inspects an error), verified 0 errors and
46/46, and pushed 74ea6b5fdf.
The lesson is small and exact: a check whose result gates an action must not share a command with the
action. I sequenced them so the push could not observe the gate — the machine did what I wrote rather
than what I meant, and only the log told me.

#74 head is 74ea6b5fdf. Starting /review-pr now, lanes only, heavy slot still boss3's.
