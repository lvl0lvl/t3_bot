FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-2x5 · #5 retitled — it is no longer the PR I opened, and the description said otherwise · 661 tests, MERGEABLE at 3d888c308 · still not ready: the verifier's tail truncated again
AT: 2026-09-12 00:14 EDT

bd t3_bot-2x5 · head 3d888c308 · MERGEABLE · 661 tests · typecheck 0 · clean · not ready.

RETITLED, WHICH I WANT ON THE RECORD AS A JUDGEMENT RATHER THAN HOUSEKEEPING. It opened as "Match a channel
name whatever case the agent types". That is now about a fifth of it. The review turned up that the case rule
was the SMALLER half of the problem, and a description that survives a change it did not survive is the same
lie I have now corrected three times on two PRs.

    Match a channel or a member whatever the agent types, emit what the aggregate stores

THE BODY NOW LEADS WITH THE MECHANISM instead of the symptom, because the mechanism is the thing worth
reviewing: normalise the KEY, never the VALUE. Every defect fixed here is one error in different clothes —
emitting a normalised form instead of the bytes the other side stores. Case, sigils, and four Unicode
normalisations are all the same bug.

It also names what the review found that the rule did NOT: the mis-delivery to the wrong member, the member
who could not be mentioned and then could be mentioned by accident, single-pass stripping, and NFC. And it
carries a table of the three assertions that were aimed at `created` when the property was about
`channelLookups`, since that pattern is more useful to the next reader than any individual fix.

ONE CONCERN, ON YOUR RULE RATHER THAN MINE: thirteen commits is more than "one concern per PR" comfortably
allows, and I considered splitting. I did not, and the reason is that every commit after the first is a
consequence of the same seam defect — none of them stands alone, and a reader bisecting this would want them
together. If you disagree, the natural cut is before 9a7393513 (the emit fix), which is where it stops being
about case and starts being about the seam. Say the word and I will split it; I would rather be told than
assume my judgement on your rule.

STILL NOT READY. The blind verifier's report truncated for the third time before its tail, and I have asked
for the remainder. Its last round found a real gap on a fix it had specified itself, so I am not treating
"mostly reported" as reported.

boss1's a44 work is worth your attention on the merge-order question: he has the decider half of iin, the
archived-channel rule, the empty-handle refusal, and NFC, all with mutants replayed on the REBASED tree
rather than assumed — he caught a textually clean rebase that left a test green for the wrong reason. #5
does not depend on any of it, but it will need a rebase over it, and I am treating that rebase as a change
to be verified rather than a formality.
