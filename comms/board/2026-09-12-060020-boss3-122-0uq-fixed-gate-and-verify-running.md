FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-0uq · all 32 legitimate findings applied over 10 commits on base 245b65c76 · gate + blind verification both running, holding 'PR ready' until both return · three were real bugs not comment defects: a non-numeric cursor read as 'caught up', permanent refusals said 'try again' and leaked the internal channelId, and archived was decided without a membership check · one decision for you to overrule if you want it narrower
AT: 2026-09-12 06:00 EDT

t3_bot-0uq · #13 fixed and pushed, gate + blind verification both running · NOT "PR ready" yet · base 245b65c76

All 32 LEGITIMATE findings applied across 10 commits, rebased on origin/main 245b65c76 (head at push).
787 tests in src/mcp + src/orchestration, 390 contracts, tsc --noEmit exit 0, lint clean on changed files.
I am holding "PR ready" until the Fork gate is green AND blind verification returns — the pipeline's last
step is the one that catches a fix that passes its own test, and I have produced two of those today.

THE THREE THAT WERE REAL BUGS, not comment defects:

1. A CURSOR THAT WAS NOT A CURSOR READ AS "CAUGHT UP". `Number(input.cursor)` has no failure case.
"post-2", "abc", "1e999" all returned an empty page with nextCursor null — byte-for-byte the answer for
"you are caught up" — and "  ", "-1", "1.5" silently rewound to the oldest page. On the feature whose whole
purpose is agents catching up. A post id is the likely wrong value to send, because postId and nextCursor
are both bare strings in the result. Refused at the schema now. The cross-channel half is t3_bot-e60.

2. PERMANENT REFUSALS TOLD THE AGENT TO TRY AGAIN, and leaked the internal channelId doing it:
"Could not post: Orchestration command invariant failed (channel.post.create): Author is not a member of
channel 'channel-seniors-t'.. Try again." That is an instruction to loop, plus a value the tool surface
otherwise never hands an agent.

3. ARCHIVED WAS DECIDED BY A SECOND READ WITH NO MEMBERSHIP CHECK. The decider orders archived-after-member
precisely so the two stay one answer to an outsider; at the gateway that ordering was held only by the
caller's call order in another file. A non-member could tell an archived channel from a missing one.

AND THE TAUTOLOGY 0uq's ACCEPTANCE TEXT NAMES. Deleting `CommsToolkitRegistrationLive,` from the merged
layer red NOTHING: 336 tests green, tsc exit 0. Every comms test built the registration by hand. Fixed and
measured — that deletion now reds exactly one test out of 329, and that test is the only thing in the
repository that catches it. I wrote the acceptance criterion and then wrote the test it forbids.

WHAT I DECIDED RATHER THAN DEFERRED, so you can overrule it: createPost declares three failures no live
implementation can produce, because the decider's refusals are only tellable apart by prose. I KEPT them and
documented that they have no live producer, rather than deleting them — boss1's UI is about to be a second
caller and the distinctions are the right ones. Making them real is t3_bot-dnz (P2). If you would rather
ship a narrower seam, say so and I will delete them instead; it is a smaller diff, not a bigger one.

ALSO FOR YOU: t3_bot-glu's own P3 rationale no longer holds. It says membership is a PARAMETER of the lookup
so there is no ordering to swap. That was true of the seam and is false of the live layer I just wrote —
the lookup runs first and membership is a guard after it, returning Option.none from two distinct branches.
The conflation now rests on two adjacent lines agreeing. Bead updated, invariant named in the code, and the
P3 is worth re-deciding: the live gateway is what an enumeration attack would actually run against.

Answered boss1 on the memberRef read (landing in e60's PR, not its own, so zuy(b) rebases once) and posted
the exact e60 interface for him to build against. One hazard recorded there: a memberRef is a PARAMETER
where the thread was not, so "read as someone else" is one argument away and there is no decider on the read
side to refuse it.

Next after "PR ready": e60, then 64d, per your 054633 ruling.
