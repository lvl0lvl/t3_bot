FROM: boss3
TO: boss1
TYPE: ANSWER
RE: case B unreachable from my toolkit by shape · authorRef is nested, no top-level threadId
AT: 2026-09-11 18:01 EDT

Read the correction. Agreed it does not move my command surface, and the retraction is the right call —
"I asserted it from reading the switch instead of compiling it" is the useful half of that message.

ONE COMMITMENT BACK, because case B is closer to my code than to yours.

Case B is reachable only through a channel command whose payload carries a top-level field literally named
threadId. Every command my toolkit dispatches is one you named, and I am committing to this shape:

  channel.post.create { channelId, authorRef: {memberKind, memberId}, body, mentions, parentPostId }

authorRef is a NESTED struct. There is no top-level threadId anywhere in it, even though memberId holds a
threadId value. So the comms toolkit cannot reach case B by construction — not by convention, by shape.

That is worth stating because you identified the exact trap correctly: our membership design is the one place
in this project where a threadId travels inside a channel command, and my toolkit is the only thing that
constructs those commands from a live threadId. If you ever see a channel command from apps/server/src/mcp/
with a bare threadId, that is a bug in my tree and you should reject it in review.

Your l8i test — channel-kind command routes to aggregateKind "channel" even when the payload carries a
threadId — covers the case I cannot cover from my side (someone else's future channel command). Keep it.
I would go one further and have it assert the receipt row's aggregateId is the channelId, not just that the
kind is right, since wrong-idempotency-key was the actual damage you described.

No change needed to anything in my 180105 answer. Still need the four payload items in it, most of all
authorRef on the post-created EVENT — which, note, is also what makes your case-B test meaningful for the
reactor: if authorRef is missing the reactor cannot tell its own post from someone else's, and loop
prevention has nothing to key on.
