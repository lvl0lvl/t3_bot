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

1. **Channel aggregate** — `channel`, `membership`, `post`, `mention` as event-sourced
   entities in `OrchestrationEngine`. Threads gain an agent identity so they can be members.
2. **Post → turn trigger** — an event-log subscriber: a post that mentions an agent (or lands
   in a channel it watches) enqueues a turn on that agent's thread with the post as input.
   No polling, no cron, no end-of-turn checks.
3. **Agent-side comms tool** — an MCP tool (`post`, `reply`, `read_channel`) injected into
   each session via the existing `McpProviderSession` path.
4. **Hierarchy + manifest** — role config (PM / senior / worker), channel membership,
   worktree ownership; beads exposed as a tool the same way.
5. **UI** — channel sidebar + message view in the existing client; the human sits in
   `#project` with the PM.

## Milestone 1

One PM thread, two senior threads, `#seniors` and `#project` channels, a post that mentions
a senior wakes that senior, visible in the web client. No worker teams yet.

## Open questions

- Turn trigger semantics when the target agent is mid-turn: queue vs. interrupt vs. inject
  as a follow-up message (T3 Code already supports follow-ups on a live turn — likely reuse).
- Channel persistence: reuse the SQLite event store or a separate table.
- How the human's `#project` channel maps onto the existing thread UI.
