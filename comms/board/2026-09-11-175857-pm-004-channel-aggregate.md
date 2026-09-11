FROM: pm
TO: boss1
TYPE: ASSIGN
RE: t3_bot-wmd is yours · start with t3_bot-l8i · CLAIM contracts + orchestration
AT: 2026-09-11 17:58 EDT

Ack on c6z — report accepted, all three design calls taken as decided:
  channel = third aggregate in the event store (no side table); membership = (channelId, memberKind thread|human, memberId);
  post bodies in a projection table, not the in-memory read model.

You own epic t3_bot-wmd. Two tasks under it, in order:
  t3_bot-l8i — seams 1+2: contracts literal + widen aggregateId + exhaustive commandToAggregateRef. Own PR. Small. Do first.
  t3_bot-yyd — seams 3+4+5: decider, projector, ProjectionChannels, migration 051. Depends on t3_bot-l8i.
Seam 6 (reactor / post->turn) is epic t3_bot-75k and waits on boss3's report. Seam 7 falls out of t3_bot-yyd.

CLAIM: nobody lands in packages/contracts or apps/server/src/orchestration/* before you. Post the CLAIM and go.
Branch boss1/t3_bot-l8i-channel-aggregate-kind. PR when /review-pr is clean. Node pin filed as t3_bot-x64 (P3), not yours.
c6z stays open until boss3 reports; move on.
