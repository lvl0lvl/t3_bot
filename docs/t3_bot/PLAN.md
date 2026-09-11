# t3_bot plan

## Why fork T3 Code

T3 Code already gives us: provider adapters for Claude (Agent SDK) and Codex (app-server) on
subscriptions, git worktree workspaces, permission routing, an event-sourced orchestration
engine with a serialized command queue, and web/desktop/mobile clients. What it lacks is
everything between agents: channels, hierarchy, and event-triggered turns.

## Target shape

```
Walt ──#project──▶ PM agent
                     │  #seniors (PM + all seniors)
          ┌──────────┼──────────┐
       Boss1       Boss3       ...        each senior: one feature area, one worktree
          │          │
      team agents  team agents            workers report up; no lateral worker comms
```

Info flows up and down the tree. Seniors also talk laterally in `#seniors`.

## Five additions to the T3 Code server

1. **Channel aggregate** — `channel`, `membership`, `post` as event-sourced entities in
   `OrchestrationEngine`. Mentions are a field on the post (`mentions: ReadonlyArray<MemberRef>`),
   not an entity: one event to read, and a post and its mentions cannot commit at different
   sequences. Posts carry `authorRef`. Threads are members as `{ memberKind: "thread", memberId }`.
2. **Post → turn trigger** — a reactor: a post that mentions an agent enqueues a turn on that
   agent's thread with the post as input. No polling, no cron, no end-of-turn checks.
   **The reactor never enqueues a turn on the thread that authored the post** — without this an
   agent posting into its own channel wakes itself forever, on real subscription tokens.
   Milestone 1 is mention-triggering only. Waking every member on every post ("channel watch")
   is deferred: with three members in `#seniors` it is a mutual wake loop on the first message
   and needs damping of its own.
3. **Agent-side comms tool** — an MCP tool (`post`, `reply`, `read_channel`) injected into
   each session via the existing `McpProviderSession` path.
4. **Hierarchy + manifest** — role config (PM / senior / worker), channel membership,
   worktree ownership; beads exposed as a tool the same way.
5. **UI** — channel sidebar + message view in the existing client; the human sits in
   `#project` with the PM.

## Milestone 1

One PM thread, two senior threads, `#seniors` and `#project` channels, a post that mentions
a senior wakes that senior, visible in the web client. No worker teams yet.

## Decisions from onboarding recon (2026-09-11, boss1 + boss3 reports on the board)

- **Channel is a third aggregate in the event store**, beside `project` and `thread`
  (`packages/contracts/src/orchestration.ts` `OrchestrationAggregateKind`). No side table: a side
  table forfeits receipt idempotency, ordered replay and the single-transaction commit.
  `commandToAggregateRef` in `OrchestrationEngine.ts` has a `thread` default. A `channel.*` command
  without a `threadId` fails to compile there (good); one that happens to carry a `threadId` is
  silently stamped as a `thread` aggregate (bad). So: the switch becomes exhaustive first (t3_bot-l8i),
  with a test that a channel command carrying a `threadId` still routes to `channel`, and **channel
  payloads never name a field `threadId`** — a thread member is `{ memberKind: "thread", memberId }`.
- **Membership** = `(channelId, memberKind: "thread" | "human", memberId)`. `ThreadId` is stable;
  threads need no new identity type.
- **Post bodies** live in a projection table (`ProjectionChannels`), not the in-memory read model,
  which is rebuilt on every event.
- **Post → turn is a reactor**, not engine code (`ThreadPullRequestReactor.ts` is the exemplar; use
  `subscribeDomainEvents` so tests drain). It issues a plain `thread.turn.start` on the target thread.
  A live turn already absorbs it as a follow-up on both providers (Claude: steer onto the prompt
  queue, same turnId; Codex: native queued `turn/start`). Queue-vs-interrupt is settled: inject.
- **Consequences of injecting:** a post that wakes a busy Claude thread emits no `turn.started`, so
  the channel UI correlates by post/mention id, never turnId (t3_bot-j6o). A turn queued during
  compaction is dropped on compaction failure with a human-facing retry message — agent-originated
  posts need retry or dead-letter before the trigger ships (t3_bot-n3y).
- **Agent-side tools** are an MCP toolkit at `apps/server/src/mcp/toolkits/comms/` modelled on
  `pullRequests/`; caller identity is the `threadId` on `McpInvocationContext`. A `comms`
  `McpCapability` is granted unconditionally. Capabilities bake at session start (Claude does not
  reload the catalog; Codex does), so the tool surface is static and membership is checked inside
  the handler.
- **No new RPC.** `channel.*` joins the `OrchestrationCommand` union; web/desktop/mobile follow.
- **Team comms during the build** are the `comms` branch board, not Claude Code's mesh — the mesh
  is scoped to `CLAUDE_CONFIG_DIR`, and the three sessions run on three accounts. Same constraint
  applies to the product: the channel layer must not depend on provider account or config dir.
