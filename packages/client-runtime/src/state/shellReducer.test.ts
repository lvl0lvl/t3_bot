import { describe, expect, it } from "vite-plus/test";

import { ChannelId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { OrchestrationShellSnapshot, OrchestrationShellStreamEvent } from "@t3tools/contracts";

import { applyShellStreamEvent } from "./shellReducer.ts";

const baseSnapshot: OrchestrationShellSnapshot = {
  snapshotSequence: 0,
  projects: [],
  threads: [],
  updatedAt: "2026-04-01T00:00:00.000Z",
};

const stubProject = {
  id: ProjectId.make("project-1"),
  title: "Test Project",
  workspaceRoot: "/workspace/test",
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
} as const;

const stubChannel = {
  id: ChannelId.make("channel-seniors"),
  name: "seniors",
  archivedAt: null,
  latestPostAt: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
} as const;

const stubThread = {
  id: ThreadId.make("thread-1"),
  projectId: ProjectId.make("project-1"),
  title: "Test Thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  pullRequests: [],
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  session: null,
} as const;

describe("applyShellStreamEvent", () => {
  it("ignores stale project upserts without mutating the snapshot", () => {
    const snapshotWithProject: OrchestrationShellSnapshot = {
      ...baseSnapshot,
      snapshotSequence: 4,
      projects: [stubProject],
    };

    for (const sequence of [3, 4]) {
      const next = applyShellStreamEvent(snapshotWithProject, {
        kind: "project-upserted",
        sequence,
        project: { ...stubProject, title: "Stale Title" },
      });

      expect(next).toBe(snapshotWithProject);
      expect(next.snapshotSequence).toBe(4);
      expect(next.projects[0]?.title).toBe("Test Project");
    }
  });

  describe("project-upserted", () => {
    it("adds a new project", () => {
      const event: OrchestrationShellStreamEvent = {
        kind: "project-upserted",
        sequence: 1,
        project: stubProject,
      };

      const next = applyShellStreamEvent(baseSnapshot, event);

      expect(next.projects).toHaveLength(1);
      expect(next.projects[0]?.id).toBe("project-1");
      expect(next.snapshotSequence).toBe(1);
    });

    it("updates an existing project", () => {
      const snapshotWithProject: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        projects: [stubProject],
      };

      const updatedProject = { ...stubProject, title: "Updated Title" };
      const event: OrchestrationShellStreamEvent = {
        kind: "project-upserted",
        sequence: 2,
        project: updatedProject,
      };

      const next = applyShellStreamEvent(snapshotWithProject, event);

      expect(next.projects).toHaveLength(1);
      expect(next.projects[0]?.title).toBe("Updated Title");
      expect(next.snapshotSequence).toBe(2);
    });
  });

  describe("project-removed", () => {
    it("removes a project by id", () => {
      const snapshotWithProject: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        projects: [stubProject],
      };

      const event: OrchestrationShellStreamEvent = {
        kind: "project-removed",
        sequence: 3,
        projectId: ProjectId.make("project-1"),
      };

      const next = applyShellStreamEvent(snapshotWithProject, event);

      expect(next.projects).toHaveLength(0);
      expect(next.snapshotSequence).toBe(3);
    });
  });

  describe("thread-upserted", () => {
    it("adds a new thread", () => {
      const event: OrchestrationShellStreamEvent = {
        kind: "thread-upserted",
        sequence: 4,
        thread: stubThread,
      };

      const next = applyShellStreamEvent(baseSnapshot, event);

      expect(next.threads).toHaveLength(1);
      expect(next.threads[0]?.id).toBe("thread-1");
      expect(next.snapshotSequence).toBe(4);
    });

    it("updates an existing thread", () => {
      const snapshotWithThread: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        threads: [stubThread],
      };

      const updatedThread = { ...stubThread, title: "Updated Thread" };
      const event: OrchestrationShellStreamEvent = {
        kind: "thread-upserted",
        sequence: 5,
        thread: updatedThread,
      };

      const next = applyShellStreamEvent(snapshotWithThread, event);

      expect(next.threads).toHaveLength(1);
      expect(next.threads[0]?.title).toBe("Updated Thread");
    });
  });

  describe("thread-removed", () => {
    it("removes a thread by id", () => {
      const snapshotWithThread: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        threads: [stubThread],
      };

      const event: OrchestrationShellStreamEvent = {
        kind: "thread-removed",
        sequence: 6,
        threadId: ThreadId.make("thread-1"),
      };

      const next = applyShellStreamEvent(snapshotWithThread, event);

      expect(next.threads).toHaveLength(0);
      expect(next.snapshotSequence).toBe(6);
    });
  });

  it("returns original snapshot for unrecognized event kinds", () => {
    const unknownEvent = { kind: "unknown-future-event", sequence: 99 } as any;
    const next = applyShellStreamEvent(baseSnapshot, unknownEvent);
    expect(next).toBe(baseSnapshot);
  });
});

describe("channels", () => {
  it("materialises the channel list on the first upsert", () => {
    // The base snapshot has no `channels` field at all, which is what a client
    // holds against a server that predates them. An upsert is the moment this
    // client learns the server has channels.
    const next = applyShellStreamEvent(baseSnapshot, {
      kind: "channel-upserted",
      sequence: 1,
      channel: stubChannel,
    } as OrchestrationShellStreamEvent);

    expect(next.channels).toEqual([stubChannel]);
    expect(next.snapshotSequence).toBe(1);
  });

  it("replaces a channel in place rather than appending a second copy", () => {
    const withChannel = applyShellStreamEvent(baseSnapshot, {
      kind: "channel-upserted",
      sequence: 1,
      channel: stubChannel,
    } as OrchestrationShellStreamEvent);

    // The field the sidebar orders by, moving — which is how a post reaches the
    // client, since there is no per-post event.
    const posted = applyShellStreamEvent(withChannel, {
      kind: "channel-upserted",
      sequence: 2,
      channel: { ...stubChannel, latestPostAt: "2026-04-01T00:01:00.000Z" },
    } as OrchestrationShellStreamEvent);

    expect(posted.channels).toHaveLength(1);
    expect(posted.channels?.[0]?.latestPostAt).toBe("2026-04-01T00:01:00.000Z");
  });

  it("removes a channel it holds", () => {
    const withChannel = applyShellStreamEvent(baseSnapshot, {
      kind: "channel-upserted",
      sequence: 1,
      channel: stubChannel,
    } as OrchestrationShellStreamEvent);

    const removed = applyShellStreamEvent(withChannel, {
      kind: "channel-removed",
      sequence: 2,
      channelId: stubChannel.id,
    } as OrchestrationShellStreamEvent);

    expect(removed.channels).toEqual([]);
  });

  it("does not turn an ABSENT channel list into an empty one on a removal", () => {
    // Absent and empty are different states and the sidebar renders them
    // differently: `undefined` is "this server never told us about channels",
    // `[]` is "you are in none". A removal for a channel this client never had
    // must not claim the second on the strength of the first — and a removal is
    // exactly the event that arrives for a channel the client is not a member
    // of, so this is the common case rather than a corner one.
    const removed = applyShellStreamEvent(baseSnapshot, {
      kind: "channel-removed",
      sequence: 1,
      channelId: stubChannel.id,
    } as OrchestrationShellStreamEvent);

    expect(removed.channels).toBeUndefined();
    // The sequence still advances: the event was applied, it just had nothing
    // to remove. Not advancing would replay it forever.
    expect(removed.snapshotSequence).toBe(1);
  });

  it("ignores a channel event at or below the snapshot sequence", () => {
    const ahead: OrchestrationShellSnapshot = { ...baseSnapshot, snapshotSequence: 5 };
    const next = applyShellStreamEvent(ahead, {
      kind: "channel-upserted",
      sequence: 5,
      channel: stubChannel,
    } as OrchestrationShellStreamEvent);

    expect(next).toBe(ahead);
  });
});
