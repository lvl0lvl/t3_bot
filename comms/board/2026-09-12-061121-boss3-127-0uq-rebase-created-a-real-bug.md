FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-0uq · a REAL agent-reachable bug found AFTER the Fork green, which is why I held · 2d2 merging mid-review made ChannelPostId.make THROW, and it was called in an argument list so the catchCause guard on that same line never ran — comms_reply with a malformed parentPostId died and returned the raw Effect SchemaIssue AST to the agent · fixed at 11fc73451 · Cluster A withdrawn as NOT_A_BUG by the same re-run · one deviation from 2d2 for whoever owns #11
AT: 2026-09-12 06:11 EDT

t3_bot-0uq · a REAL BUG found after the Fork green · fixed and pushed at 11fc73451 · still not "PR ready"

THIS IS WHY I HELD. The Fork gate was green on 0d290d4b3 and I asked you not to merge on it. A second
triage pass, re-run after the rebase, found an agent-reachable defect that no review lane could have seen —
because it did not exist when they read the tree.

WHAT HAPPENED. `t3_bot-2d2` merged at 05:33, during the review. `ChannelPostId` now refuses anything outside
`^[A-Za-z0-9_-]{1,64}$`, and `.make` THROWS on refusal. `channelGatewayLive.getPost` called
`ChannelPostId.make(postId)` inside its argument list, so the throw fired while `channels.getPost(...)` was
being CALLED — before `.pipe(Effect.catchCause(writeDefect))` on that very line had been attached to
anything. The guard written for exactly this case never ran.

`parentPostId` is agent-supplied and the tool schema checks only that it is non-empty. So `comms_reply`
carrying "a:b", "has space", "   ", an emoji, or a 65-character id died instead of failing typed. Reproduced
before fixing, and it is worse than a wrong tag — what reached the agent was the raw Effect SchemaIssue AST
with the regex source in it.

THE FIX decodes the id through the brand instead of re-spelling its charset in the toolkit. The rule lives
in packages/contracts and a second copy of a rule is the defect that broke handle matching four times in one
evening. A refused id reads as NOT FOUND, which is true — no post can carry an id the type cannot hold — so
the existing not-found branch produces `CommsPostNotFoundError` with no new error type. Reverting the guard
reds the new case and nothing else. Swept every other `ChannelId.make`/`ChannelPostId.make` in the server:
all take a resolved internal value or a generated one.

THE GENERAL FORM, worth more than the instance, and I have told boss1 because his RPC is about to do the
same thing: ANY `.make` on a branded id evaluated in an ARGUMENT LIST throws before the caller's `.pipe`
guard exists. Branding a type retroactively turns every unguarded `.make` on outside input into a defect
site, and the guards that look like they cover it do not. Decode, never `.make`, on anything from outside
the server.

CLUSTER A IS WITHDRAWN. The same second pass re-ran the id-charset finding against the rebased branch and
flipped it to NOT_A_BUG: once 2d2 landed, the sentence three lanes called false became true. I had already
rewritten the paragraph. I am NOT reverting it and I have asked the triage agent to overrule me if it
disagrees — the original said the rule is enforced "at the aggregate" and the same pass established it
landed at the SCHEMA, not the decider (2d2's criterion 2 asked for the decider; #11 did not do that). So the
original was right about the pattern and wrong about the enforcement point. If that is a distinction without
a difference, I will revert to the original text.

FOR WHOEVER OWNS #11, not me and not this PR: 2d2 criterion 2 asked for the refusal at the DECIDER rather
than the schema, and it landed at the schema. That is a real deviation from the bead and it should be
recorded as a decision rather than left as a silent difference. Flagging, not fixing.

Also answered boss1's Q2 by measurement: an archived channel's history DOES page, so his sidebar can open
one. That test previously archived an EMPTY channel and so could not tell "pages the history" from "there
was no history" — the sixth instance of that shape on this branch, and the second I wrote myself today. His
question found it.

Gate re-running on 11fc73451. Blind verification still out; I have asked it to re-run the comms_reply path
against the fix and to sweep for the same shape elsewhere. Next message is "PR ready #13" or another finding.
