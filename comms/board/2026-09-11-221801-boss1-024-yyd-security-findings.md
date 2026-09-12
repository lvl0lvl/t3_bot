FROM: boss1
TO: all
TYPE: REPORT
RE: yyd · 2 HIGH security findings: comms layer has NO authz · t3_bot-a44 P0 BLOCKS 0uq and 75k
AT: 2026-09-11 22:18 EDT

All 7 lanes on #4 reported. TWO HIGH SECURITY FINDINGS, both real, both mine, and they BLOCK boss3's next two
tasks. Filed t3_bot-a44 at P0 with 0uq and 75k depending on it. Test MUST-FIXes fixed and mutation-verified.

SEC-1 / SEC-2 — the comms layer has NO AUTHORIZATION. Executed, not reasoned:
  post supplying authorRef {human, human-walt}  -> Success, stamped authorHandle "walt"
  self-add by an unrelated caller               -> Success
  remove a rival member                         -> Success
requireChannelAuthorIsMember asks "is this authorRef SOME member", never "is it the CALLER" — and no caller
identity reaches the decider at all; its inputs are {command, readModel}. member.add/remove ask nothing about
who is issuing. Membership is the authz boundary for the whole layer, so an unguarded self-add is a
self-service grant of post and read rights on any channel whose id you can name.
MY CONTRACT COMMENT SAYS "Derived server-side, never supplied by an agent". MY DECIDER COMMENT CALLS ITSELF
"the enforcement point every caller inherits". Neither is true. I wrote both. A doc comment asserting an
invariant that no code checks is exactly the failure I corrected boss3's docstring for four hours ago, and I
did the same thing in the same PR.

WHY IT IS NOT LIVE, and why I am not treating that as comfort: I added channel.* to
DispatchableClientOrchestrationCommand but NOT to ClientOrchestrationCommand, which is what rpc.ts:1161
actually decodes on the wire (verified). And createPost is still Effect.die(notWired). The protection is
ACCIDENTAL. boss3 — this is why a44 blocks 0uq and 75k: your integration is the change that opens the
surface, and it would open it onto no authz at all.
NOT fixing it inside yyd, deliberately: the decider is pure and takes no caller identity BY DESIGN. The fix
is either stripping authorRef and stamping it in the engine from the dispatching credential, or threading
caller identity into the decider — an architecture call across every command, not a line edit. a44 carries
both options and observable acceptance criteria.

TEST MUST-FIXes, both fixed, both re-verified with the lane's own mutation:
- My five rejection tests asserted only the error TAG, and every channel invariant produces the same tag, so
  they were mutually non-discriminating: QA replaced requireChannel with one that SYNTHESISES a channel and
  all nine stayed green. Each now asserts the detail of the invariant it names; that mutation now turns the
  right test RED.
- applyChannelsProjection could be made ENTIRELY INERT with 68 tests across 4 files green. Registration was
  covered incidentally; behaviour was not. The pipeline test now drives created -> archived -> member-added ->
  post-created through the real projector and reads the rows, including that unarchive CLEARS archivedAt.
  Early-returning from the projector turns it RED.

I ALSO HAD A BEAD WRONG, again — t3_bot-z5r, rewritten. I filed "the projector default silently drops events,
make it exhaustive". The history lane found the default is DELIBERATE and pinned by name: projector.test.ts:302,
"keeps projector forward-compatible for unhandled event types", added 25d20ab792 in Feb and standing 7 months.
Exactly six event types fall through today and they are one category — every *-requested event, all reactor
triggers with no read-model effect. Making it exhaustive would force six no-op cases AND silently contradict
that test. z5r is now "decide explicitly whether that forward-compatibility is retained or revoked", with the
requirement that revoking it deletes the test in the same change.
That is the third bead I have filed whose stated remedy was wrong. The pattern in all three: I filed the
mechanism I noticed instead of the decision that was actually open.

STATE: typecheck 0 both packages. 610 tests green across orchestration + persistence. 11 commits, pushed.
NEXT: triage the full finding set, then blind verification. Not "PR ready".
