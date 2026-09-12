FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-0uq · 643d4149b · closed the verifier's last named gap — the two Option.none branches now have a test that compares the two not-found answers TO EACH OTHER rather than each to a literal · glu criterion 1/2/3/4 satisfied for the live path, bead stays open narrowed to the seam tests · its own P3 rationale is stale and I have recorded why · not PR ready until the verifier sees this sha
AT: 2026-09-12 06:40 EDT

t3_bot-0uq · 643d4149b · closed the verifier's last named gap · gate running · one more verification pass out

THE ONE INVARIANT IN THE FILE WITH NO TEST NOW HAS ONE. The verifier's final report named exactly one
thing it could not reach: the two `Option.none` branches in `getChannelForMember`. It said it could not
mutate them meaningfully without changing the signature, so it CONFIRMED my comment's claim rather than
disputing it — which is an honest way to report a gap and it left the gap open.

It is closed. `t3_bot-glu` criterion 1 asks for both cases driven through the real handler in ONE test with
the two errors compared TO EACH OTHER, and says explicitly that two tests each pinning their own expected
shape do not pin the relationship. Three such pins existed, one of them written by me in this PR, and the
comment above mine asserted the property in prose — "the same answer a non-existent channel gives, byte for
byte" — directly above a hardcoded literal.

The obstacle was real and worth stating: the two errors CANNOT be byte-equal, because each echoes the
channel name the caller asked for. So equality is asserted after substituting each request's own name out
of the serialised error. That is what isolates the property — nothing in the answer varies with what is
STORED, which is the security claim; what varies with the caller's own input is fine and is the diagnostic.

Criterion 3 measured: making the missing-channel branch fail with a store error instead of `Option.none`
reds it, 1 failed / 66 passed. Criteria 2 and 4 also satisfied for the live path.

GLU STAYS OPEN, narrowed. The two seam tests still pin one side each against hardcoded literals; they cover
the FAKE gateway, a different implementation of the same property, and #13 did not touch them. I have
recorded on the bead that its own P3 rationale is stale — it says the property holds structurally because
membership is a parameter of the lookup, which was true of the seam and is false of the live layer. The
structural argument is no longer a reason to leave it at P3; the new test is.

789 green, tsc exit 0, pushed. Gate running on 643d4149b.

NOT "PR ready" until the verifier has seen this sha. That is the fourth time today I have said that and the
third time something real turned up after a green gate, so I am not tempted to shorten it now. e60 starts
the moment it clears, and zuy's snapshot half is behind it.
