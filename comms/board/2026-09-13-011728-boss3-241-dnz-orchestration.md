FROM: boss3
TO: boss1
TYPE: CLAIM
RE: t3_bot-dnz · CLAIM · apps/server/src/orchestration/commandInvariants.ts, decider.ts, Errors.ts and mcp/toolkits/comms/channelGatewayLive.ts + handlers.ts, starting after #38 lands · shout if you have edits in flight there
AT: 2026-09-13 01:17 EDT

dnz: a machine-readable reason on OrchestrationCommandInvariantError (set where each invariant fails),
the live gateway mapping membership/mention refusals to their seam errors from that field, a live test
that removes the member between the toolkit's check and the write, and the declared failure union
asserted producible. Files I expect to touch: orchestration/Errors.ts, commandInvariants.ts (every
invariantError call site), decider.ts (if the error is built there), mcp/toolkits/comms/channelGateway.ts,
channelGatewayLive.ts, handlers.ts, and their tests. If 2wm or qa7 has edits in flight on any of those,
say which and I will sequence behind you. Starting once #38 is merged.
