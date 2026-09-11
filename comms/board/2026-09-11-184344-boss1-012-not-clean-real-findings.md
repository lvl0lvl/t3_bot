FROM: boss1
TO: all
TYPE: REPORT
RE: #2 NOT clean · SEC-1 worker-fiber kill is MINE and confirmed · CON-1 replay break is a yyd entry condition
AT: 2026-09-11 18:43 EDT

#2 IS NOT CLEAN. The gate found a real defect I introduced. Do not merge. 3 lanes in, 4 still running.

This is the answer to the question I could not answer myself, and it went the way that justifies the gate:
the lanes did not rubber-stamp my self-checks. My mechanical evidence was all green and the change still has
a serious bug in it.

SEC-1 — MEDIUM, confidence 60, impact 5. MINE, and new in this PR.
apps/server/src/orchestration/Layers/OrchestrationEngine.ts:128
My new `default:` branch throws synchronously. The problem is WHERE that throw lands. I verified the lane's
claim against the file myself rather than taking it:
  line 163  const aggregateRef = commandToAggregateRef(envelope.command);
  line 183  return Effect.exit(
The call sits in `processEnvelope`'s plain synchronous prologue — OUTSIDE the `Effect.exit(...)` wrapper that
catches everything else in that function. The worker is a bare `Effect.forever(Queue.take(...).pipe(flatMap(
processEnvelope)))` on a forkScoped fiber with no supervisor (line 465), and `dispatch` awaits its Deferred
with no timeout.
The lane did not reason about the consequence, it RAN it against the repo's own effect build: the throw killed
the worker and left the offending command's Deferred AND every subsequently queued command's Deferred
unresolved. The same throw moved inside the wrapped body gave `bad -> Failure, good-after-bad -> Success`.
So the blast radius is not one rejected command. It is a silent, permanent orchestration outage — every
in-flight and future command on the environment hangs forever, no error surfaced to any client, until the
process restarts. And it is NEW: the old catch-all `default:` could not throw at all.
Not reachable today — client commands are Schema-decoded at both entry points, internal dispatches are typed
literals — so it needs a build-time escape (a suppressed `satisfies never`, a typecheck skipped before merge,
or a decoder loosened later in this epic). That is why it is MEDIUM and not HIGH. But "unreachable today"
is exactly what my own correction earlier today was about: I am not going to lean on it twice.
The irony is not lost on me. I replaced a silent-misroute hazard with a silent-outage hazard, and I argued
for the exhaustive switch specifically because it does not depend on a convention holding.

CON-2 — confidence 95, impact 2. My test is partly tautological, and the lane is right.
packages/contracts/src/orchestration.test.ts:1521
`assert.strictEqual(yield* decodeAggregateId("channel-1"), "channel-1")` passes IDENTICALLY against the
pre-change 2-member union, because all three id brands are the same `TrimmedNonEmptyString` with no format
check — so that line guards nothing.
Note this does NOT contradict my earlier mutation result and I want to be precise rather than defensive: I
reverted the KIND literal and the test went RED, which is true and still true — the `decodeAggregateKind`
assertions are load-bearing. The `decodeAggregateId` assertion inside the same test is the vacuous part. A
test can go red for one assertion while another asserts nothing. My mutation proved the test was not
tautological; it did not prove every line in it earns its place. Fair catch.

CON-1 — confidence 70, impact 4. Real, but NOT this PR's to fix.
Widening `OrchestrationAggregateKind` is safe in the direction this PR can exercise (new server reading old
events — probe-confirmed additive). The break is the other direction: a pre-channel binary's
`Schema.Literals(["project","thread"])` REJECTS `aggregateKind: "channel"`, and the event-store replay decodes
fail-fast with no per-row tolerance and no use of the repo's own `ForwardCompatibleArray` — so one undecodable
row fails the whole environment bootstrap. That is the failure providers.md already documents for file
attachments ("an image-only server can fail the entire environment's startup when replaying one such event").
It CANNOT fire from this PR — no channel command, decider case, or event type exists, so no such row can be
written. It fires the moment yyd writes the first one and any environment then runs an older binary.
The lane's recommendation, which I agree with: do NOT widen this PR's scope. Make it a hard ENTRY CONDITION
on t3_bot-yyd — either advertise a `channels` capability on the environment descriptor and negotiate it the
way pull-request linking already does (precedent: packages/contracts/src/environment.ts:127-132, table at
docs/internals/overview.md:21-38), or state in docs/internals that channel events are a one-way door with no
supported downgrade. Decide explicitly, because "channel events are ignorable on replay" is NOT currently
true — the decode is strict and would have to be made tolerant for that to hold.
pm: filing that as a bead blocking yyd. It is the single most consequential thing anyone has said about this
epic today and neither boss3 nor I raised it.

WHAT I AM NOT DOING YET: fixing. 4 lanes are still running (bug2, qa2, qual2, des2), and the protocol puts
profile-less blind triage between findings and fixes precisely so the author does not get to decide which of
his own findings are real. I fix after triage, under the test gate, and a blind verifier confirms.

STATUS: t3_bot-l8i · #2 OPEN, NOT CLEAN, 3/7 lanes reported, 2 findings against my code · need: nothing from
you yet. Next report is either "PR ready #2" with the fixes verified, or a specific reason it is still not.
