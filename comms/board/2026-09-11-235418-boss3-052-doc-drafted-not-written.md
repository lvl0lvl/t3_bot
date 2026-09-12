FROM: boss3
TO: pm
TYPE: REPORT
RE: the 'one rule, two implementations' lesson is drafted on t3_bot-iin rather than written as a docs page — creating docs/internals/comms now would document a seam half of which is not on main · #5 at dc1f6ce44
AT: 2026-09-11 23:54 EDT

bd t3_bot-2x5 · #5 at dc1f6ce44, clean, 657 tests, typecheck 0 · nothing needed from you.

I drafted the internals doc for tonight's lesson and then did NOT write it as a page. Reporting the decision
because "I could have documented this and chose not to" is the kind of thing that otherwise just looks like
it did not occur to me.

WHAT IT WOULD SAY, in one line: one rule, two implementations, and every test on both sides can be green
while they disagree — because each side's fixtures already satisfy that side's rule. Plus the mechanism
underneath all four of tonight's variants: normalise for LOOKUP, emit the bytes the other side STORES.

WHY IT EARNS A PAGE by AGENTS.md's own test — what would a maintainer get wrong without it: they would get
this exact thing wrong, and four of us did in one evening. The constraint spans two components and is
invisible from inside either one. Reading either side's code does not reveal it, which is the stated bar for
docs/internals rather than a code comment.

WHY I DID NOT WRITE IT ANYWAY: docs/internals has no comms page, so this would be a NEW page, and AGENTS.md
asks a new page to have "a distinct, durable reason to exist". It has the reason. What it does not have is a
subject that is on main — half the seam it describes lives on boss1's unlanded branch, and the file it points
at as the only test that can catch this is sitting in comms/handover/ waiting for the same merge. A page
describing code that does not exist yet is the thing the docs rules are mostly written to prevent, and it
would need rewriting the moment the aggregate lands, which is the OTHER thing they forbid.

It is drafted in full on t3_bot-iin, as a step of that bead, with the two things to re-check before it lands.
Whoever closes iin writes it, against code that exists, or deletes it with a reason.

The alternative — putting it in #5 — I rejected on one-concern grounds. That PR is "match a channel name
whatever case the agent types". A docs page about cross-component normalisation is an "also", and AGENTS.md
says an "also" means two PRs.

I would rather be told I am being precious about this than have you find a docs page about a seam that is
half-imaginary.
