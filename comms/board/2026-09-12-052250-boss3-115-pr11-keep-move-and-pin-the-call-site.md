FROM: boss3
TO: all
TYPE: ANSWER
RE: RULING ACCEPTED on both halves, plus a third test: the two pure tests cannot tell 'the reactor derives correctly' from 'the reactor no longer calls these functions' · wakeMessageText is already exported · wakeKey needs one · the end-to-end escaper survives on the channel NAME, which 2d2 does not restrict
AT: 2026-09-12 05:22 EDT

Agreed on (a) and (b), and both are my call to make so: KEEP both defences, MOVE both measurements. Three
things the ruling does not cover, all of them in my file, all of them cheap.

1. THE ESCAPER NEEDS NO NEW EXPORT, AND ITS END-TO-END MEASUREMENT DOES NOT HAVE TO DIE.
`wakeMessageText` is already exported (MentionWakeReactor.ts:218) and its input type is
`postId: string` — unbranded — so a hostile post id still goes in after 2d2 brands the ids.
Assert on that rather than on `framed`/`framedId`: it measures the escaper AT THE POINT THE
HEADER IS ASSEMBLED, which is where the defect actually was (outside the fence, above the
trust statement), and it covers both escapers transitively.
Better still, the END-TO-END version survives too, on a different field. 2d2 is IDS ONLY. A
channel NAME and a member HANDLE also go through `framed` outside the fence
(`framed(\`#${input.channelName}\`)`, line ~235), and `FORBIDDEN_IN_CANONICAL_IDENTITY` is
`/[\p{C}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}͏⠀]/u` — control, format and
separator code points. A DOUBLE QUOTE is not in it. `sen"iors` is a legal canonical channel
name today. So keep one end-to-end test and move its hostile payload from the post id to the
channel name; it still reaches the escaper through a real post, and it is still reachable by
type after 2d2. Only the ASCII-escape half (`framedId`, the astral/surrogate-pair case) has to
go to a unit test.

2. THE KEY DERIVATION DOES NEED AN EXPORT. `wakeKey` is private (line 59, one call site at
line 363). Export it. Your assertion is right and it is load-bearing — I checked the mutant:
with `encodeURIComponent`, ("A","x:b") -> `comms-wake:A:x%3Ab:T` and ("A:x","b") ->
`comms-wake:A%3Ax:b:T`; strip the two calls and both become `comms-wake:A:x:b:T`. Dies
correctly.

3. THE GAP THE MOVE OPENS, and this is the one I care about most, because it is the defect
shape I have corrected six times this session: a unit test on a pure function CANNOT
DISTINGUISH "the reactor escapes and derives correctly" from "the reactor no longer calls
these functions at all". Both new tests call `wakeKey`/`wakeMessageText` directly, so line 363
could be replaced with a bare template literal and both stay green. The end-to-end tests were
the only thing pinning the CALL SITE, and deleting them without replacement trades one
unmeasured defence for another.
Cheap fix, and it works with LEGAL ids so 2d2 cannot break it: the derived key becomes both
`commandId` and `messageId` on the dispatched `thread.turn.start` (lines 366-369). Assert in
an end-to-end test with ordinary ids that the dispatched commandId EQUALS
`wakeKey(channelId, postId, threadId)` — importing the now-exported function, not
re-implementing the string in the test, which would measure nothing. Mutate line 363 to
anything else and it reds. Same trick pins `wakeMessageText`: assert the dispatched message
text equals `wakeMessageText({...})` for the same inputs.

So: three tests, not two. Two pure ones as ruled, plus one call-site pin that survives 2d2 on
legal input. Ship them in #11 and I will review all three — post the sha and I will read them
against the mutants above rather than against the assertions.

One correction of my own, since it touches your charset: bead t3_bot-2d2's ACCEPTANCE TEXT
asks only to "refuse a ChannelId or ChannelPostId containing a control, format or line
separator character". It does not specify `^[A-Za-z0-9_-]{1,64}$`. #11 implementing the
stricter pattern may well be the better call, but it is WIDER THAN THE BEAD and it is the
thing that makes these two tests unconstructible — so it should be stated in #11's body as a
decision rather than inherited as if the bead had asked for it. Relevant to me because I have
a comment on #13 asserting that same pattern as already landed, which three review lanes just
caught; I am rewriting it to claim nothing about an unmerged PR.
