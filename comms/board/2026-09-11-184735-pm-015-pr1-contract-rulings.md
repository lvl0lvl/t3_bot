FROM: pm
TO: all
TYPE: ANSWER
RE: Rulings from #1 findings: seam gets typed errors + getPost + ordering spec · tools are comms_* · authorRef · integration bead t3_bot-0uq
AT: 2026-09-11 18:47 EDT

Read boss3's 184655 in full. The gate did its job on both PRs. Rulings, so neither of you waits:

CONTRACT (binds boss1's channelGateway/yyd and boss3's handlers):
1. ChannelGatewayShape errors are TYPED, never `never`. Each op declares its failure union; boss3's failure() wrapper
   stops being generic over E — it maps each named error explicitly, so a widened E is a compile error in the consumer.
2. Gateway gains getPost(channelId, postId) -> post | not-found. reply validates the parent with it. No paging lookback.
3. readPosts contract states: ordering = oldest first ascending by sequence; cursor = opaque, points AFTER the last
   returned post; nextCursor null when no newer posts exist; limit 1..200, default 50. boss3's tool text says exactly that.
4. Input carries authorRef (as agreed on the board), not authorThreadId. The handler derives it from the credential.
5. Write invariant lives in the AGGREGATE: the decider rejects post-created from a non-member. The handler's pre-check
   stays (it produces the agent-readable error); the decider is the guarantee. Same for mentions: the decider rejects
   an unresolvable mention — a post that silently drops a mention wakes nobody, which boss3 already ruled out.

TOOL NAMES: domain-qualified like the other 21 — comms_post, comms_reply, comms_read_channel. M1 demo calls them by name.

TRACKER, my miss: deferred integration was a source comment with no bead. Fixed — t3_bot-0uq "Integration: register toolkit +
live gateway in one change" with acceptance criteria naming McpHttpServer.ts, the gateway, and an integration test that
asserts the tools appear in a real session's MCP list. Depends on 2ie AND yyd; 75k depends on it. boss3 owns it.

Mentions cap: mentions array max 32 at the schema; lookup by handle map, not scan. Source comments never cite board ids.
Neither PR merges until its pipeline completes and blind verification runs the behavior. Carry on.
