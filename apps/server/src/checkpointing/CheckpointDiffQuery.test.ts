import {
  CheckpointRef,
  ProjectId,
  ThreadId,
  TurnId,
  VcsProcessExitError,
} from "@t3tools/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { describe, expect } from "vite-plus/test";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { checkpointRefForThreadTurn, turnStartCheckpointRefForThreadTurn } from "./Utils.ts";
import * as CheckpointDiffQuery from "./CheckpointDiffQuery.ts";
import * as CheckpointStore from "./CheckpointStore.ts";
import { CheckpointThreadNotFoundError } from "./Errors.ts";

function makeThreadCheckpointContext(input: {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly checkpointTurnCount: number;
  readonly checkpointRef: CheckpointRef;
}): ProjectionSnapshotQuery.ProjectionThreadCheckpointContext {
  return {
    threadId: input.threadId,
    projectId: input.projectId,
    workspaceRoot: input.workspaceRoot,
    worktreePath: input.worktreePath,
    checkpoints: [
      {
        turnId: TurnId.make("turn-1"),
        checkpointTurnCount: input.checkpointTurnCount,
        checkpointRef: input.checkpointRef,
        status: "ready",
        files: [],
        assistantMessageId: null,
        completedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

/** A checkpoint context with one ready checkpoint per turn count, refs by name. */
function makeThreadCheckpointContextForTurns(input: {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly turnCounts: ReadonlyArray<number>;
}): ProjectionSnapshotQuery.ProjectionThreadCheckpointContext {
  return {
    threadId: input.threadId,
    projectId: input.projectId,
    workspaceRoot: "/tmp/workspace",
    worktreePath: null,
    checkpoints: input.turnCounts.map((turnCount) => ({
      turnId: TurnId.make(`turn-${turnCount}`),
      checkpointRef: checkpointRefForThreadTurn(input.threadId, turnCount),
      checkpointTurnCount: turnCount,
      status: "ready" as const,
      files: [],
      assistantMessageId: null,
      completedAt: "2026-01-01T00:00:00.000Z",
    })),
  };
}

/** The snapshot query as the turn-diff path sees it: the checkpoint context and nothing else. */
function makeSnapshotQueryWithCheckpointContext(
  threadCheckpointContext: ProjectionSnapshotQuery.ProjectionThreadCheckpointContext,
): ProjectionSnapshotQuery.ProjectionSnapshotQuery["Service"] {
  return {
    getUserInputActivity: () => Effect.die("unused"),
    getCommandReadModel: () => Effect.die("unused"),
    getSnapshot: () => Effect.die("unused"),
    getShellSnapshot: () => Effect.die("unused"),
    getArchivedShellSnapshot: () => Effect.die("unused"),
    getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
    getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
    getEventReplayStats: () => Effect.die("unused"),
    getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
    getProjectShellById: () => Effect.succeed(Option.none()),
    getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
    getImportedAgentSessionSources: () => Effect.die("unused"),
    getThreadCheckpointContext: () => Effect.succeed(Option.some(threadCheckpointContext)),
    getFullThreadDiffContext: () => Effect.die("unused"),
    getThreadRuntimeContext: () => Effect.die("unused"),
    getTurnStartMessage: () => Effect.die("unused"),
    getThreadShellById: () => Effect.succeed(Option.none()),
    getThreadDetailById: () => Effect.succeed(Option.none()),
    getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
    searchThreads: () => Effect.succeed({ matches: [] }),
  };
}

describe("CheckpointDiffQuery.layer", () => {
  it.effect("uses the narrow full-thread context lookup for all-turns diffs", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-full-thread");
      const threadId = ThreadId.make("thread-full-thread");
      const toCheckpointRef = checkpointRefForThreadTurn(threadId, 4);
      let getThreadCheckpointContextCalls = 0;
      let getFullThreadDiffContextCalls = 0;
      const diffCheckpointsCalls: Array<{
        readonly fromCheckpointRef: CheckpointRef;
        readonly toCheckpointRef: CheckpointRef;
        readonly cwd: string;
        readonly ignoreWhitespace: boolean;
      }> = [];

      const checkpointStore: CheckpointStore.CheckpointStore["Service"] = {
        isGitRepository: () => Effect.succeed(true),
        captureCheckpoint: () => Effect.void,
        hasCheckpointRef: () => Effect.succeed(true),
        restoreCheckpoint: () => Effect.succeed(true),
        diffCheckpoints: ({ fromCheckpointRef, toCheckpointRef, cwd, ignoreWhitespace }) =>
          Effect.sync(() => {
            diffCheckpointsCalls.push({
              fromCheckpointRef,
              toCheckpointRef,
              cwd,
              ignoreWhitespace,
            });
            return "full thread diff patch";
          }),
        deleteCheckpointRefs: () => Effect.void,
        renameCheckpointRef: () => Effect.void,
      };

      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(Layer.succeed(CheckpointStore.CheckpointStore, checkpointStore)),
        Layer.provideMerge(
          Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
            getUserInputActivity: () => Effect.die("unused"),
            getCommandReadModel: () =>
              Effect.die("CheckpointDiffQuery should not request the command read model"),
            getSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
            getShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
            getArchivedShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
            getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
            getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
            getEventReplayStats: () => Effect.die("unused"),
            getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
            getProjectShellById: () => Effect.succeed(Option.none()),
            getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
            getImportedAgentSessionSources: () => Effect.die("unused"),
            getThreadCheckpointContext: () =>
              Effect.sync(() => {
                getThreadCheckpointContextCalls += 1;
                return Option.none();
              }),
            getFullThreadDiffContext: () =>
              Effect.sync(() => {
                getFullThreadDiffContextCalls += 1;
                return Option.some({
                  threadId,
                  projectId,
                  workspaceRoot: "/tmp/workspace",
                  worktreePath: "/tmp/worktree",
                  latestCheckpointTurnCount: 4,
                  toCheckpointRef,
                });
              }),
            getThreadRuntimeContext: () => Effect.die("unused"),
            getTurnStartMessage: () => Effect.die("unused"),
            getThreadShellById: () => Effect.succeed(Option.none()),
            getThreadDetailById: () => Effect.succeed(Option.none()),
            getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
            searchThreads: () => Effect.succeed({ matches: [] }),
          }),
        ),
      );

      const result = yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* query.getFullThreadDiff({
          threadId,
          toTurnCount: 4,
          ignoreWhitespace: true,
        });
      }).pipe(Effect.provide(layer));

      expect(getThreadCheckpointContextCalls).toBe(0);
      expect(getFullThreadDiffContextCalls).toBe(1);
      expect(diffCheckpointsCalls).toEqual([
        {
          cwd: "/tmp/worktree",
          fromCheckpointRef: checkpointRefForThreadTurn(threadId, 0),
          toCheckpointRef,
          ignoreWhitespace: true,
        },
      ]);
      expect(result).toEqual({
        threadId,
        fromTurnCount: 0,
        toTurnCount: 4,
        diff: "full thread diff patch",
      });
    }),
  );

  it.effect("diffs one turn from its start snapshot, not the stored turn ref", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-1");
      const threadId = ThreadId.make("thread-1");
      const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
      const diffCheckpointsCalls: Array<{
        readonly fromCheckpointRef: CheckpointRef;
        readonly toCheckpointRef: CheckpointRef;
        readonly cwd: string;
        readonly ignoreWhitespace: boolean;
      }> = [];

      const threadCheckpointContext = makeThreadCheckpointContext({
        projectId,
        threadId,
        workspaceRoot: "/tmp/workspace",
        worktreePath: null,
        checkpointTurnCount: 1,
        checkpointRef: toCheckpointRef,
      });

      const checkpointStore: CheckpointStore.CheckpointStore["Service"] = {
        isGitRepository: () => Effect.succeed(true),
        captureCheckpoint: () => Effect.void,
        hasCheckpointRef: () => Effect.succeed(true),
        restoreCheckpoint: () => Effect.succeed(true),
        diffCheckpoints: ({ fromCheckpointRef, toCheckpointRef, cwd, ignoreWhitespace }) =>
          Effect.sync(() => {
            diffCheckpointsCalls.push({
              fromCheckpointRef,
              toCheckpointRef,
              cwd,
              ignoreWhitespace,
            });
            return "diff patch";
          }),
        deleteCheckpointRefs: () => Effect.void,
        renameCheckpointRef: () => Effect.void,
      };

      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(Layer.succeed(CheckpointStore.CheckpointStore, checkpointStore)),
        Layer.provideMerge(
          Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
            getUserInputActivity: () => Effect.die("unused"),
            getCommandReadModel: () =>
              Effect.die("CheckpointDiffQuery should not request the command read model"),
            getSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
            getShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
            getArchivedShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
            getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
            getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
            getEventReplayStats: () => Effect.die("unused"),
            getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
            getProjectShellById: () => Effect.succeed(Option.none()),
            getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
            getImportedAgentSessionSources: () => Effect.die("unused"),
            getThreadCheckpointContext: () => Effect.succeed(Option.some(threadCheckpointContext)),
            getFullThreadDiffContext: () => Effect.die("unused"),
            getThreadRuntimeContext: () => Effect.die("unused"),
            getTurnStartMessage: () => Effect.die("unused"),
            getThreadShellById: () => Effect.succeed(Option.none()),
            getThreadDetailById: () => Effect.succeed(Option.none()),
            getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
            searchThreads: () => Effect.succeed({ matches: [] }),
          }),
        ),
      );

      const result = yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
          ignoreWhitespace: true,
        });
      }).pipe(Effect.provide(layer));

      const expectedFromRef = turnStartCheckpointRefForThreadTurn(threadId, 1);
      expect(diffCheckpointsCalls).toEqual([
        {
          cwd: "/tmp/workspace",
          fromCheckpointRef: expectedFromRef,
          toCheckpointRef,
          ignoreWhitespace: true,
        },
      ]);
      expect(result).toEqual({
        threadId,
        fromTurnCount: 0,
        toTurnCount: 1,
        diff: "diff patch",
      });
    }),
  );

  it.effect("falls back to the turn ref when git refuses the start snapshot", () =>
    Effect.gen(function* () {
      // A thread from before start snapshots existed has no `start/` ref.
      const projectId = ProjectId.make("project-legacy");
      const threadId = ThreadId.make("thread-legacy");
      const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
      const diffCheckpointsFromRefs: Array<CheckpointRef> = [];

      const threadCheckpointContext = makeThreadCheckpointContextForTurns({
        projectId,
        threadId,
        turnCounts: [1, 2],
      });

      const checkpointStore: CheckpointStore.CheckpointStore["Service"] = {
        isGitRepository: () => Effect.succeed(true),
        captureCheckpoint: () => Effect.void,
        hasCheckpointRef: () => Effect.die("no preflight"),
        restoreCheckpoint: () => Effect.succeed(true),
        diffCheckpoints: ({ fromCheckpointRef: from }) => {
          diffCheckpointsFromRefs.push(from);
          return from.includes("/start/")
            ? Effect.fail(
                new VcsProcessExitError({
                  operation: "GitVcsDriver.checkpoints.diffCheckpoints",
                  command: "git diff",
                  cwd: "/tmp/workspace",
                  exitCode: 128,
                  detail: "fatal: bad revision",
                }),
              )
            : Effect.succeed("legacy diff patch");
        },
        deleteCheckpointRefs: () => Effect.void,
        renameCheckpointRef: () => Effect.void,
      };

      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(Layer.succeed(CheckpointStore.CheckpointStore, checkpointStore)),
        Layer.provideMerge(
          Layer.succeed(
            ProjectionSnapshotQuery.ProjectionSnapshotQuery,
            makeSnapshotQueryWithCheckpointContext(threadCheckpointContext),
          ),
        ),
      );

      const result = yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* query.getTurnDiff({ threadId, fromTurnCount: 1, toTurnCount: 2 });
      }).pipe(Effect.provide(layer));

      expect(diffCheckpointsFromRefs).toEqual([
        turnStartCheckpointRefForThreadTurn(threadId, 2),
        fromCheckpointRef,
      ]);
      expect(result.diff).toBe("legacy diff patch");
    }),
  );

  it.effect("a range spanning turns starts from the stored ref of the turn that ends it", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-range");
      const threadId = ThreadId.make("thread-range");
      const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
      const diffCheckpointsFromRefs: Array<CheckpointRef> = [];

      const threadCheckpointContext = makeThreadCheckpointContextForTurns({
        projectId,
        threadId,
        turnCounts: [1, 2, 3],
      });

      const checkpointStore: CheckpointStore.CheckpointStore["Service"] = {
        isGitRepository: () => Effect.succeed(true),
        captureCheckpoint: () => Effect.void,
        hasCheckpointRef: () => Effect.die("no preflight"),
        restoreCheckpoint: () => Effect.succeed(true),
        diffCheckpoints: ({ fromCheckpointRef: from }) => {
          diffCheckpointsFromRefs.push(from);
          return Effect.succeed("range diff patch");
        },
        deleteCheckpointRefs: () => Effect.void,
        renameCheckpointRef: () => Effect.void,
      };

      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(Layer.succeed(CheckpointStore.CheckpointStore, checkpointStore)),
        Layer.provideMerge(
          Layer.succeed(
            ProjectionSnapshotQuery.ProjectionSnapshotQuery,
            makeSnapshotQueryWithCheckpointContext(threadCheckpointContext),
          ),
        ),
      );

      yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* query.getTurnDiff({ threadId, fromTurnCount: 1, toTurnCount: 3 });
      }).pipe(Effect.provide(layer));

      expect(diffCheckpointsFromRefs).toEqual([fromCheckpointRef]);
    }),
  );

  it.effect("defaults to hide whitespace changes", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-default-whitespace");
      const threadId = ThreadId.make("thread-default-whitespace");
      const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
      const diffCheckpointsCalls: Array<{ readonly ignoreWhitespace: boolean }> = [];

      const threadCheckpointContext = makeThreadCheckpointContext({
        projectId,
        threadId,
        workspaceRoot: "/tmp/workspace",
        worktreePath: null,
        checkpointTurnCount: 1,
        checkpointRef: toCheckpointRef,
      });

      const checkpointStore: CheckpointStore.CheckpointStore["Service"] = {
        isGitRepository: () => Effect.succeed(true),
        captureCheckpoint: () => Effect.void,
        hasCheckpointRef: () => Effect.succeed(true),
        restoreCheckpoint: () => Effect.succeed(true),
        diffCheckpoints: ({ ignoreWhitespace }) =>
          Effect.sync(() => {
            diffCheckpointsCalls.push({ ignoreWhitespace });
            return "diff patch";
          }),
        deleteCheckpointRefs: () => Effect.void,
        renameCheckpointRef: () => Effect.void,
      };

      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(Layer.succeed(CheckpointStore.CheckpointStore, checkpointStore)),
        Layer.provideMerge(
          Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
            getUserInputActivity: () => Effect.die("unused"),
            getCommandReadModel: () =>
              Effect.die("CheckpointDiffQuery should not request the command read model"),
            getSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
            getShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
            getArchivedShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
            getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
            getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
            getEventReplayStats: () => Effect.die("unused"),
            getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
            getProjectShellById: () => Effect.succeed(Option.none()),
            getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
            getImportedAgentSessionSources: () => Effect.die("unused"),
            getThreadCheckpointContext: () => Effect.succeed(Option.some(threadCheckpointContext)),
            getFullThreadDiffContext: () => Effect.die("unused"),
            getThreadRuntimeContext: () => Effect.die("unused"),
            getTurnStartMessage: () => Effect.die("unused"),
            getThreadShellById: () => Effect.succeed(Option.none()),
            getThreadDetailById: () => Effect.succeed(Option.none()),
            getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
            searchThreads: () => Effect.succeed({ matches: [] }),
          }),
        ),
      );

      yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
        });
      }).pipe(Effect.provide(layer));

      expect(diffCheckpointsCalls).toEqual([{ ignoreWhitespace: true }]);
    }),
  );

  it.effect("does not preflight checkpoint refs before diffing", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-no-preflight");
      const threadId = ThreadId.make("thread-no-preflight");
      const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
      let hasCheckpointRefCallCount = 0;

      const threadCheckpointContext = makeThreadCheckpointContext({
        projectId,
        threadId,
        workspaceRoot: "/tmp/workspace",
        worktreePath: null,
        checkpointTurnCount: 1,
        checkpointRef: toCheckpointRef,
      });

      const checkpointStore: CheckpointStore.CheckpointStore["Service"] = {
        isGitRepository: () => Effect.succeed(true),
        captureCheckpoint: () => Effect.void,
        hasCheckpointRef: () =>
          Effect.sync(() => {
            hasCheckpointRefCallCount += 1;
            return true;
          }),
        restoreCheckpoint: () => Effect.succeed(true),
        diffCheckpoints: () => Effect.succeed("diff patch"),
        deleteCheckpointRefs: () => Effect.void,
        renameCheckpointRef: () => Effect.void,
      };

      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(Layer.succeed(CheckpointStore.CheckpointStore, checkpointStore)),
        Layer.provideMerge(
          Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
            getUserInputActivity: () => Effect.die("unused"),
            getCommandReadModel: () =>
              Effect.die("CheckpointDiffQuery should not request the command read model"),
            getSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
            getShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
            getArchivedShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
            getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
            getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
            getEventReplayStats: () => Effect.die("unused"),
            getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
            getProjectShellById: () => Effect.succeed(Option.none()),
            getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
            getImportedAgentSessionSources: () => Effect.die("unused"),
            getThreadCheckpointContext: () => Effect.succeed(Option.some(threadCheckpointContext)),
            getFullThreadDiffContext: () => Effect.die("unused"),
            getThreadRuntimeContext: () => Effect.die("unused"),
            getTurnStartMessage: () => Effect.die("unused"),
            getThreadShellById: () => Effect.succeed(Option.none()),
            getThreadDetailById: () => Effect.succeed(Option.none()),
            getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
            searchThreads: () => Effect.succeed({ matches: [] }),
          }),
        ),
      );

      yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
          ignoreWhitespace: true,
        });
      }).pipe(Effect.provide(layer));

      expect(hasCheckpointRefCallCount).toBe(0);
    }),
  );

  it.effect("fails when the thread is missing from the snapshot", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread-missing");

      const checkpointStore: CheckpointStore.CheckpointStore["Service"] = {
        isGitRepository: () => Effect.succeed(true),
        captureCheckpoint: () => Effect.void,
        hasCheckpointRef: () => Effect.succeed(true),
        restoreCheckpoint: () => Effect.succeed(true),
        diffCheckpoints: () => Effect.succeed(""),
        deleteCheckpointRefs: () => Effect.void,
        renameCheckpointRef: () => Effect.void,
      };

      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(Layer.succeed(CheckpointStore.CheckpointStore, checkpointStore)),
        Layer.provideMerge(
          Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
            getUserInputActivity: () => Effect.die("unused"),
            getCommandReadModel: () =>
              Effect.die("CheckpointDiffQuery should not request the command read model"),
            getSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
            getShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
            getArchivedShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
            getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
            getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
            getEventReplayStats: () => Effect.die("unused"),
            getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
            getProjectShellById: () => Effect.succeed(Option.none()),
            getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
            getImportedAgentSessionSources: () => Effect.die("unused"),
            getThreadCheckpointContext: () => Effect.succeed(Option.none()),
            getFullThreadDiffContext: () => Effect.succeed(Option.none()),
            getThreadRuntimeContext: () => Effect.die("unused"),
            getTurnStartMessage: () => Effect.die("unused"),
            getThreadShellById: () => Effect.succeed(Option.none()),
            getThreadDetailById: () => Effect.succeed(Option.none()),
            getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
            searchThreads: () => Effect.succeed({ matches: [] }),
          }),
        ),
      );

      const error = yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
        });
      }).pipe(Effect.provide(layer), Effect.flip);

      expect(error).toBeInstanceOf(CheckpointThreadNotFoundError);
      expect(error).toMatchObject({
        operation: "CheckpointDiffQuery.getTurnDiff",
        threadId,
      });
      expect(error.message).toBe(
        "Checkpoint invariant violation in CheckpointDiffQuery.getTurnDiff: Thread 'thread-missing' not found.",
      );
    }),
  );
});
