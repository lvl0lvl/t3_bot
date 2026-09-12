FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-a44 · PR #6 rebased onto the post-#7 main at 9d38a3ab2 so the new gate actually runs on it · Fork CI watching · blind verifier dispatched on the FIXES, because I wrote them · xvx closed

xvx CLOSED. Merged as #7; its first run found the pre-existing vp check failure you then fixed on main. Noting
the sequence because it is the argument for the gate rather than a story about my PR: the gate's FIRST action
was to surface a failure that had been true on main for hours and invisible to everyone.

#6 REBASED onto aa3468d57 and pushed at 9d38a3ab2. Two reasons rather than housekeeping:
1. Your new rule needs the four Fork jobs green on the PR's CURRENT headSha, and #6's previous head predates
   the workflow existing on main, so there was nothing to be green.
2. A rebase is where I have been bitten twice tonight, so I re-verified locally on the rebased tree instead of
   trusting 'Successfully rebased': typecheck 0, 775/80 green. Fork CI is watching for the four jobs on
   9d38a3ab2 specifically and I will confirm the sha, not the word.

BLIND VERIFIER DISPATCHED ON THE FIXES, and this is the part I want on the record as a decision rather than a
formality. I said I would not call #6 ready until someone who did not write the fixes had looked at them. The
three review lanes found the findings; I fixed them and replayed my own mutants. That is exactly the shape of
'the author's own agent declares it done' that /review-pr's Phase 7 exists to refuse — and tonight has given
three separate demonstrations that my own confidence is the least reliable signal available: the NFC ordering,
the self-referential tripwire, and the dead regex disjunct were all things I had already checked and reported
as sound.

So the verifier is profile-less by design, told not to read any report or commit message that explains intent,
and told to mutate every guard rather than confirm the happy path. It has three jobs beyond re-checking:
  - an INDEPENDENT idempotency sweep over every code point 0x0000-0x2FFF plus random inputs, rather than my
    fixture. My fixture is what missed this three times.
  - a full SWEEP of 0x0000-0xFFFF plus the variation-selector supplement for any code point that is still
    both storable and invisible. bug6 found my \p{C} gate missed an entire category; I widened it to
    Default_Ignorable_Code_Point plus two singletons, and I do not know that I got the boundary right.
  - an ADVERSARIAL pass for what my change BROKE rather than what it fixed. Collapsing whitespace and
    refusing more characters can only have made the accepted set SMALLER, and I have not checked what
    legitimate input fell out — a CJK name, a non-Latin handle, an emoji handle with a ZWJ sequence or
    variation selector, an RTL name. If an emoji handle is now refused that is a real regression and it is
    mine, not a lane's to find.

That last one is the one I expect to produce a finding, because every check I have run tonight was pointed at
the thing I was trying to fix.

STATE: #6 at 9d38a3ab2, local typecheck 0, 775/80. Will post 'PR ready #6' only with the four Fork jobs green
on that sha AND the verifier's verdicts in hand — and if the adversarial pass finds a regression, with that
fixed first.
AT: 2026-09-12 01:22 EDT

