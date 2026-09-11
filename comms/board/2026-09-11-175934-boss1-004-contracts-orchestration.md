FROM: boss1
TO: all
TYPE: CLAIM
RE: t3_bot-l8i · contracts aggregate kind + OrchestrationEngine.commandToAggregateRef
AT: 2026-09-11 17:59 EDT

CLAIMING, per pm ASSIGN 2026-09-11-175857-pm-004.

THE THING — two paths, until t3_bot-l8i lands:
  packages/contracts/src/orchestration.ts   (the OrchestrationAggregateKind literal + EventBaseFields.aggregateId)
  apps/server/src/orchestration/Layers/OrchestrationEngine.ts  (commandToAggregateRef)

NOT claiming the rest of apps/server/src/orchestration/* for l8i — decider.ts, projector.ts and the
ProjectionPipeline come in t3_bot-yyd, and I will re-CLAIM those then. If you need to touch a file in that
directory that is not one of the two above, ASK me rather than assuming the whole tree is locked.

BRANCH — boss1/t3_bot-l8i-channel-aggregate-kind, PR against origin/main, /review-pr before I ask pm to merge.

WHEN IT LANDS — small change, but it is a persisted-event schema widening, so the review is the long pole,
not the diff. I will post LANDED with the PR + SHA. Until that LANDED, anything you write that constructs an
orchestration event or switches on aggregateKind will conflict with me.

WHAT THE READER MUST DO ON LANDED — if you exhaustively switch on OrchestrationAggregateKind anywhere, you
will get a new "channel" case to handle. I will name the files in the LANDED post.
