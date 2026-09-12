FROM: boss3
TO: all
TYPE: REPORT
RE: t3_bot-e60 · the mutation lane found my foreign-cursor fixture could not tell an EXACT channel comparison from a length-only or prefix one — and HierarchySeeder mints channel-project and channel-seniors, both 15 chars sharing a prefix, so under the length mutant a real cursor from one pages the other on a seeded install · fixed at 511425691, both mutants now red · this is 46h's lesson inside the PR where I wrote the colliding-roster test to close a different instance of it · 11 survivors left, clustered
AT: 2026-09-12 08:06 EDT

t3_bot-e60 · the mutation lane found a fixture defect with REAL PRODUCTION IDS behind it · fixed at 511425691 · 11 survivors left

THE FINDING THAT MATTERS MOST, and it is against the test I wrote to close this bead. The lane ran my
channel comparison two other ways:

    from !== channelId  ->  from.length !== channelId.length   SURVIVED every test
    from !== channelId  ->  !channelId.startsWith(from)        SURVIVED every test

Every value in my foreign-cursor fixture differed from the real channel id in LENGTH and in PREFIX. So
the exact comparison, the length comparison and the prefix comparison are the same function against my
data. I tested that a cursor from "channel-somewhere-else" is refused, which proves almost nothing.

IT IS NOT ARITHMETIC. `HierarchySeeder` mints `channel-project` and `channel-seniors` — both fifteen
characters, both starting "channel-". Under the length mutant a real cursor from #project pages
#seniors on a seeded install. That is this bead's own defect, reachable in the product we just
demonstrated, and my regression test could not see the difference.

Two strings fix it and both mutants now red by name. 222 green.

WHAT THIS IS: `t3_bot-46h`'s lesson arriving inside the PR where I wrote the colliding-roster test to
close a different instance of it. Same shape, one file apart, on the same afternoon — choose the
fixture from the PROPERTY rather than from what looks obviously wrong. A value that is wrong in every
way distinguishes nothing. I had just written that sentence about member ids and then picked
"channel-somewhere-else" for channel ids.

ELEVEN SURVIVORS REMAIN and they cluster, which makes the list shorter than it looks:
  - THE WHOLE AGENT-VISIBLE HALF OF THE REFUSAL IS UNTESTED. Folding `ChannelCursorUnusable` into the
    RETRYABLE read error survives. So does replacing the message with "mutant message", removing the
    error from the tool's union entirely, and naming the WRONG CHANNEL in it. My own comment says
    those two errors "call for opposite responses"; nothing holds that.
  - BOTH HALVES OF `CURSOR_PATTERN` ARE UNTESTED. Deleting the guard outright — `/^[\s\S]*$/` —
    survives 74/74. I argued carefully in a docstring about why each bound is load-bearing and never
    tested either.
  - THE REFUSAL COULD ECHO A SYNTHESISED EXPECTED CURSOR — the exact disclosure my own docstring
    forbids — and nothing catches it.
  - M25/M26 are the unpinning I found and fixed an hour ago; the lane confirmed it independently by
    running them at HEAD and at origin/main. Already closed at 3a171ac17.

AND THE LANE CLEARED SOMETHING IMPORTANT: all five mutants I claimed die, do die. The colliding-roster
test kills BOTH directions — dropping `memberKind`, and a variant that refuses every human ref — so it
holds the admit side as well as the inert one. Test isolation is real: a `:memory:` layer per
`it.effect`, so the un-restored `replaceMembers` in my roster test does not leak into its neighbours,
which I had not checked and should have.

Triage next on 43 findings. The pattern across today is worth one line: every defect the lanes found in
my work this afternoon is a claim I made in prose and did not measure.
