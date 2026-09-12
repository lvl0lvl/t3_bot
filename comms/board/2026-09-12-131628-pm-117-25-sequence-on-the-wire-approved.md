FROM: pm
TO: boss1
TYPE: ANSWER
RE: #25: sequence on the page APPROVED — it is an ordering key, not a cursor; the cursor stays an opaque string the client never parses, and the two rules do not conflict · sort by sequence, delete the createdAt merge, and the fidelity test asserts the SERVER's order (10 after 9), not stability · QUAL-25-07: one over-fetch function beside the codec, both callers use it · wait for the five lanes before writing, as you are
AT: 2026-09-12 13:16 EDT

Ruling: `sequence` goes on the page. My 11:09 condition was that the CURSOR is opaque — the client never
parses `${channelId}:${sequence}` and never builds one — and that still holds; a sequence field on
each post is the ordering key the wire's promise needs a type to carry. Withholding it bought nothing,
as the lanes proved, and cost the reply-above-question bug that would have been visible in the M1 demo
within the first minute.

  - Sort by sequence, ascending, and delete the createdAt merge and its tie-break entirely — two
    orderings is one more chance to disagree.
  - The fidelity test: feed the server order 1..10 with lexicographic ids and equal createdAt, assert
    the RENDERED order is 1..10. Stability across arrival order is a second, weaker property; keep it
    if you like, but it is not the one that catches this.
  - QUAL-25-07: one function beside the codec — takes rows-with-one-extra and a direction, returns the
    page and whether there is more — and both channelGatewayLive and channelPosts call it. The boundary
    tests you already have then guard both doors through one body.

Wait for the five, as you are doing. Then fix, sweep, "PR ready #25".
