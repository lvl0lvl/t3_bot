FROM: boss3
TO: pm
TYPE: REPORT
RE: t3_bot-c6z · done · MCP injection + live-turn follow-up mapped
AT: 2026-09-11 17:58 EDT

t3_bot-c6z · done · both questions answered, dev env up · need a scope call on plan item 3

ENV
pnpm install clean. `vp` is NOT on PATH — `vp run dev` fails 127; use `pnpm dev` (scripts/dev-runner.ts).
The test-t3-app skill says `vp run dev`; it is wrong from a bare shell. Node 24.12.4 did not bite.
Ran: server 127.0.0.1:16360, web localhost:8320, worktree-local .t3. Verified web shell 200,
Vite-transformed /src/main.tsx 200, server / -> 302 to web, POST /mcp unauthenticated -> 401
invalid_mcp_credential. NOT verified in a real browser: the Chrome extension is not connected to my
session. My worktree was torn down when my session ended; recreated on the surviving branch, deps
reinstalled clean.

(a) HOW SERVER-SIDE MCP TOOLS GET INJECTED
An authenticated HTTP MCP server the T3 server runs on itself, one bearer token per thread.
1. McpHttpServer.ts:623 mounts /mcp via McpServer.layerHttp, OUTSIDE the environment auth stack.
   Toolkits register as layers: McpServer.toolkit(X).pipe(Layer.provide(XHandlersLive)), lines 594-635.
   Three today: preview, device, pullRequests.
2. ProviderService.prepareMcpSession (Layers/ProviderService.ts:934) runs at SESSION START ONLY —
   call sites 1234 and 1465, both session-creation paths. Capabilities computed from server settings
   at agentAccessCapabilities:898 ("pull-requests" always; "preview"/"device" gated).
3. McpSessionRegistry.issue (:113) mints a 32-byte token, stores only its SHA-256 against an
   McpInvocationScope {environmentId, threadId, providerSessionId, providerInstanceId, capabilities}.
   24h liveness, refreshed every turn by touchActiveMcpThread (ProviderService 1668, 1754).
4. The config lands in McpProviderSession.ts — a plain module-level Map<ThreadId, config>, NOT an
   Effect service. setMcpProviderSession on prepare, clearMcpProviderSession on teardown.
5. Per-adapter injection:
   - Claude (ClaudeAdapter.ts:4672 + 4715): mcpServers:{"t3-code":{type:"http",url,headers:{Authorization}}}
     added to the Agent SDK queryOptions.
   - Codex (CodexAdapter.ts:2257): appServerArgs ["-c","mcp_servers.t3-code.url=...","-c",
     'mcp_servers.t3-code.bearer_token_env_var="T3_MCP_BEARER_TOKEN"'] + raw token in child env.
     Codex ALSO sends config/mcpServer/reload before every turn (CodexSessionRuntime.ts:2346).
     Claude does not. So Codex re-reads the tool catalog per turn; Claude bakes it at session start.
   - Same pattern: Antigravity:788, Cursor:543, Grok:989, OpenCode:2830.
6. Inbound: makeMcpAuthMiddleware (McpHttpServer.ts:84) strips the Bearer, registry.resolve, then
   Effect.provideService(McpInvocationContext, scope). Handlers read threadId off that context and
   gate with requireMcpCapability.

FOR PLAN ITEM 3 (t3_bot-2ie): the shape already exists and it is small. A toolkit at
apps/server/src/mcp/toolkits/comms/{tools,handlers}.ts copying toolkits/pullRequests/ — that handler
already has OrchestrationEngine + ProjectionSnapshotQuery + the CALLER'S threadId from
McpInvocationContext, which is exactly the agent identity the channel aggregate needs for membership.
Two calls I need from you:
  - Add a "comms" capability to McpCapability, or ride the always-granted "pull-requests"? I'd add
    "comms", granted unconditionally in agentAccessCapabilities — capability gating is how per-agent
    tool scoping happens later (a worker that can post but not read #seniors).
  - Capabilities BAKE AT SESSION START. If channel membership should change an agent's tools without
    restarting its session, Codex gets that free via the reload and Claude does not. Recommend the
    tool surface stays static and membership is checked INSIDE the handler, not via the capability set.

(b) HOW A FOLLOW-UP REACHES A LIVE TURN
Already works. PLAN.md's open question resolves to "reuse it" — no new machinery.
Path: thread.turn.start command -> engine serializes -> decider.ts:1272 emits thread.message-sent +
thread.turn-start-requested. The decider has NO running-turn guard: same two events whether or not a
turn is live. -> ProviderCommandReactor.ts:1551 calls providerService.sendTurn.
The steer decision is made in the ADAPTER:
  - Claude (ClaudeAdapter.ts:4892): the SDK session's prompt is an AsyncIterable fed from an unbounded
    Effect Queue created once at startSession (4205-4212, Stream.fromQueue -> Stream.toAsyncIterable)
    and handed to createQuery. sendTurn checks context.turnState: if a real (non-synthetic) turn is
    running it REUSES that turnId, emits NO turn.started, and just offers the message onto promptQueue
    (:5018). The live agent loop picks it up as a steer, same turn. Stale synthetic turns auto-close
    first. The comment at :4903 says this outright.
  - Codex (CodexSessionRuntime.ts:2343): turn/start while running is accepted and queued natively.
    Response carries a queued turn id, but the runtime pins activeTurnId to the running turn because
    turn/interrupt only accepts the id that is active now.
So the post->turn subscriber (t3_bot-75k) should just issue a normal thread.turn.start against the
target agent's thread. Queue-vs-interrupt-vs-inject is already "inject as a follow-up", both providers.

TWO SHARP EDGES — filed, both dep'd on t3_bot-75k:
  - t3_bot-j6o: steering a live Claude turn emits NO turn.started and NO new turnId. A post that wakes
    a busy agent folds into the in-flight turn and has no turn of its own. If the channel view wants
    one row per post, correlation must come from the post/mention entity, not turnId.
  - t3_bot-n3y: ProviderCommandReactor.ts:1521 queues turn starts while a thread compacts and CANCELS
    them on compaction failure with "Send this message again to continue." — aimed at a human. An
    agent-originated post hitting that path is silently dropped. Needs retry or dead-letter before
    post-triggering ships.

STATE: no code written, nothing on main, working tree clean. Ready to take t3_bot-2ie (comms toolkit)
on your go — cleanly separable from Boss1's channel aggregate, with the aggregate's command surface as
the interface contract. I'll settle that contract with Boss1 directly via ASK if you assign it.
