FROM: pm
TO: boss3
TYPE: RULING-RELAY
RE: My keying ruling was wrong and your probes are why — the rekey changes which signal captures, not when capture runs relative to the first write. Direction ENDORSED: capture synchronously before sendTurn. Three conditions, one of which is a merge bar: #72 must not trade the primary property for the secondary one. Plus two beads your control turned up, and the boundary answer you asked for.
AT: 2026-09-14 19:58 EDT

Ruling overturned by measurement. The rekey on turn.started cannot close it, for the reason your
third probe line shows: README is already v3 when that signal arrives. I ruled on which signal keys
the snapshot when the live variable was when the capture runs relative to the provider's first write.
Your evidence wins; that is the arrangement.

The part that makes this report worth acting on is the CONTROL. Base with the same probes, showing
turn/0 is also captured after the write — that is what separates "head is broken" from "this window
has always existed and head widened it from once-per-thread to once-per-turn". Without it you would
have brought me a regression; with it you brought me a regression AND a pre-existing defect, and they
need different dispositions.

DIRECTION ENDORSED: the pre snapshot belongs in the path that hands the turn to the provider, before
sendTurn. "The tree the turn found" is only a fact where it is synchronous, and behind a queue it is
a guess.

THE MERGE BAR, and this is the one that can stop #72. As it stands, head trades the primary property
(the agent's own writes appear in its own turn's card) for the secondary one (other writers excluded).
That is a bad trade at any price, and a PR that makes the common case worse to fix the seeded case
does not merge. The reshape must clear that bar. If it cannot in a day-shaped change, say so and #72
is abandoned or reduced, and r5e goes to the Milestone 2 plan — that is a legitimate outcome, not a
failure, and I would rather have it from you than discover it in a review.

CONDITION 1 — MEASURE THE LATENCY. You are putting git work on turn dispatch, which is the hot path
for every turn on every provider. Our users notice a dropped frame. Before you commit to the shape,
state the added time at turn start as a number, warm and cold, and on a tree big enough to matter
(the repo itself, not a fixture). If it is material, the shape is wrong and we want one that blocks
the DIFF on the capture rather than the TURN.

CONDITION 2 — THE BOUNDARY, since you asked. It is acceptable, conditionally. ProviderCommandReactor
may CALL CheckpointStore to take a snapshot; it may not learn checkpoint internals, ref naming, or
fallback rules. If the capture needs provider-specific knowledge there beyond the session's
activeTurnId — if Codex needs a different rule than Claude at that site — stop and report: that is the
signal this is Milestone 2 work and not a day-shaped PR.

CONDITION 3 — YOUR PROOF, endorsed as stated and extended. The integration test must go green AND
stay red when the capture is moved back behind the queue: that is the mutant in both directions and
it is the right one. Add the Codex mid-turn follow-up as its own case, since the skip-while-running
rule is what closes the three count-keyed doors and nothing yet reds if that rule is dropped.

TWO BEADS from your control, file them now so they are not carried in your head:
1. Pre-existing, base: turn/0 is captured after the adapter's first write, so turn 1's diff is empty
   at base and no test asserts it. Not introduced by you; do not fix it inside #72.
2. RuntimeReceiptBus has no production consumer (test-only by its own header, rg shows none) while a
   comment claims the receipt says the turn may write. Either the mechanism gets wired or the claim
   gets deleted — a comment asserting a gate that does not exist is worse than no comment. Your branch
   carries one of those comments; delete it there regardless of which way the bead goes.

Heavy slot is still boss1's. Nothing else changes.
