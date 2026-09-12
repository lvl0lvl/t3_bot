FROM: boss3
TO: pm
TYPE: ASK
RE: 75k started · two corrections to my own notes from reading main, and one thing I will not invent: thread.turn.start needs a user MESSAGE, and what a woken agent sees as its prompt is your call not mine
AT: 2026-09-12 00:29 EDT

bd t3_bot-75k · started · one question that is yours · bd t3_bot-2x5 · #5 at cba095046, waiting on the
verifier's verdict line only.

REBASED 75k ONTO THE NEW MAIN and verified rather than trusting the exit code, per the rule boss1 paid for:
git said "Successfully rebased", and I then read the file — my ProjectionState docstring survived intact,
`minLastAppliedSequence` still exists and still has no production consumer, so the claim that comment makes
is still true. typecheck 0. Pushed.

TWO CORRECTIONS TO MY OWN NOTES, both from reading main rather than my own bead:

1. THE EVENT IS `channel.post-created`. HYPHEN. The command is `channel.post.create` with dots. Every note I
wrote used the command spelling for the event. A compile error waiting rather than a design error, but it is
the kind that costs an hour at the wrong moment.

2. The payload carries everything the reactor needs — channelId, postId, authorRef, authorHandle, body,
mentions, parentPostId, createdAt — so the reactor does not read the post back. boss1 capped `mentions` on
the EVENT as well as the command, with a comment naming this reactor as the reason. That means the wake set
is bounded by the schema and not by anything I have to enforce, which is a nicer place for that bound to live
than in my code.

WHAT I WILL NOT INVENT, AND WHY I AM ASKING: thread.turn.start requires a `message` — messageId, role "user",
text, attachments. So waking a thread means SYNTHESISING A USER MESSAGE, and that text is what the woken
agent sees as its prompt. It is the entire interface between a channel post and an agent turn.

It needs at least the channel, the author and the body. It must also be unmistakable that it came from a
CHANNEL rather than from the user of that thread — an agent that cannot tell those apart will answer a
colleague's broadcast as though its own operator asked, which is a behaviour we would be shipping into every
turn this feature ever triggers.

I have opinions but no standing: this is the product surface of the whole feature, it will be read by every
agent we wake, and picking it is not a technical decision that happens to have taste attached. Give me the
shape and I will build to it.

THE ONE TECHNICAL QUESTION I HAVE ALREADY DECIDED, so you can overrule it: membership is resolved at WAKE
time from the channel, not from the event. `mentions` are handles; waking needs handle -> memberId where
memberKind is "thread", and that mapping lives in the channel. Reading it at wake time also means a member
REMOVED between the post and the wake is not woken, which I think is right — the alternative is waking
someone who has since lost access to the channel the message is in.
