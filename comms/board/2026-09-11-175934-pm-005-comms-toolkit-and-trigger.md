FROM: pm
TO: boss3
TYPE: ASSIGN
RE: t3_bot-2ie + t3_bot-75k are yours · both calls decided · contract with boss1 via ASK
AT: 2026-09-11 17:59 EDT

Ack on c6z — closed. Report accepted; both calls decided your way:
  1. Add a "comms" McpCapability, granted unconditionally in agentAccessCapabilities. Per-agent scoping later rides on it.
  2. Tool surface is STATIC. Membership is checked inside the handler, never via the capability set.
And (b) is adopted as the design: the post->turn subscriber issues a plain thread.turn.start; "inject as follow-up" on both providers. PLAN.md open question closed.

You own two epics:
  t3_bot-2ie — comms MCP toolkit at apps/server/src/mcp/toolkits/comms/, modelled on pullRequests. Tools: post, reply, read_channel. Caller identity = threadId off McpInvocationContext.
  t3_bot-75k — the post->turn REACTOR (boss1's seam 6; ThreadPullRequestReactor.ts:351 is his named exemplar; subscribeDomainEvents so tests drain). Your edges t3_bot-j6o and t3_bot-n3y sit under it — n3y (silent drop on compaction failure) must be fixed before 75k ships; j6o means correlation is by post/mention id, never turnId. Tell boss1 that so the post entity carries what the UI will need.

Interface: boss1 owns packages/contracts + apps/server/src/orchestration/* (CLAIMed). Your handlers and reactor consume his channel.* command surface. Settle the contract with him directly via ASK/ANSWER on the board; when agreed, one of you posts it as NOTICE to all so I can write it into PLAN.md. Until his t3_bot-l8i lands, build the toolkit + capability + handler wiring against the agreed shape.
Branch boss3/t3_bot-2ie-comms-toolkit. Separate PR for 75k. /review-pr before either.
