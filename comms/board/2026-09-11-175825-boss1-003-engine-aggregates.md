FROM: boss1
TO: pm
TYPE: REPORT
RE: t3_bot-c6z · done · 2 aggregates, channel hangs on 7 seams
AT: 2026-09-11 17:58 EDT

ENV — green, no blockers.
pnpm install clean. `vp run dev` up: server 127.0.0.1:16110, web localhost:8070 (200), 50 migrations,
worktree-local .t3. Worktree .claude/worktrees/boss1+t3_bot-c6z-onboarding, branch boss1/t3_bot-c6z-onboarding.

NODE — 24.12.0 vs package.json engines ^24.13.1. Did NOT bite: install clean, server boots, migrations
apply. engine-strict is off so it is advisory. Worth pinning before it bites someone silently; not blocking me.

AGGREGATES — there are exactly TWO.
packages/contracts/src/orchestration.ts:1539
  OrchestrationAggregateKind = Schema.Literals(["project", "thread"])
Every event carries aggregateKind + aggregateId: ProjectId | ThreadId in EventBaseFields (:1828).
Routing: apps/server/src/orchestration/Layers/OrchestrationEngine.ts:63 commandToAggregateRef.
  project.create / project.meta.update / project.delete -> project
  DEFAULT -> { aggregateKind: "thread", aggregateId: command.threadId }

*** That default is the thing to know. A channel.* command added to the union today gets stamped as a
thread aggregate with aggregateId: undefined. No type error. Wrong receipt rows, wrong hasEventAfter
scoping, wrong idempotency key. The work starts by making that switch exhaustive, not by adding events. ***

Flow: dispatch -> serialized command queue (one worker fiber) -> receipt idempotency check -> pure decider
(decider.ts:209) -> ONE sql transaction appending events + projecting + upserting the receipt -> after
commit: read-model swap, then PubSub publish. Read model is {snapshotSequence, projects[], threads[],
updatedAt} — flat arrays, no channel slot.

WHERE A CHANNEL AGGREGATE HANGS — 7 seams, in order
1. contracts/orchestration.ts:1539 — add "channel" to the literal, widen aggregateId. This is a PERSISTED
   event schema change: must stay decodable on replay for older environments (overview.md).
2. OrchestrationEngine.ts:63 — exhaustive switch, delete the default branch. Do this first.
3. decider.ts — channel.* cases, pure, same withEventBase({aggregateKind:"channel"}) shape as project.create.
4. projector.ts — channel + membership slots on the read model; createEmptyReadModel seeds them. Post BODIES
   go in a projection table, not the in-memory command read model — that array is rebuilt every event.
5. persistence — ProjectionChannels repo beside ProjectionThreads/ProjectionProjects, registered in
   ProjectionPipeline.ts (:483 block), plus migration 051_.
6. post -> turn trigger is a REACTOR, not engine code. ThreadPullRequestReactor.ts:351 is the smallest
   exemplar. Use subscribeDomainEvents (not streamDomainEvents) so tests can drain it — no sleeps.
7. wire — NO new RPC. One orchestration.dispatchCommand method (rpc.ts:1160); joining the OrchestrationCommand
   union gets web/desktop/mobile for free. Contracts change, all surfaces follow.

PLAN.md OPEN QUESTIONS — my read
- Channel persistence: reuse the event store, do not add a side table. A side table forfeits receipt
  idempotency, ordered replay and the single-transaction commit, and the mention->turn trigger would then
  need its own delivery guarantee. Channel-as-third-aggregate is strictly LESS machinery.
- Mid-turn trigger: the reactor dispatches a command; the engine's serialized queue already orders it.
  Follow-up-on-live-turn looks like the reuse path but I have NOT verified it — boss3 is reading
  ProviderCommandReactor / the adapters for exactly this. Defer to his REPORT before we commit.
- Threads as channel members: ThreadId is already stable, so membership can be
  (channelId, memberKind: "thread"|"human", memberId). Threads do not need a new identity type.

NEED FROM YOU
- A bd id for the channel aggregate work (t3_bot-wmd is the epic). Seams 1/2 touch packages/contracts and
  apps/server/src/orchestration/* — both CLAIM-list paths — so say whether boss3 lands anything there first
  and I will CLAIM before I open.
- Nothing merged, nothing committed. c6z left in_progress pending your ack.
