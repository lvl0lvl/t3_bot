import { assert, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { VcsRepositoryDetectionError } from "@t3tools/contracts";

import * as GitManager from "./GitManager.ts";
import * as GitWorkflowService from "./GitWorkflowService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import { mockService, unstubbed } from "../testUtils/mockService.ts";

function makeLayer(input: {
  readonly detect: VcsDriverRegistry.VcsDriverRegistry["Service"]["detect"];
}) {
  return GitWorkflowService.layer.pipe(
    Layer.provide(
      mockService(VcsDriverRegistry.VcsDriverRegistry)({
        get: unstubbed,
        resolve: unstubbed,
        detect: input.detect,
      }),
    ),
    Layer.provide(
      mockService(GitVcsDriver.GitVcsDriver)({
        createRef: unstubbed,
        switchRef: unstubbed,
        initRepo: unstubbed,
        listLocalBranchNames: unstubbed,
        setBranchUpstream: unstubbed,
        removeWorktree: unstubbed,
        pruneWorktrees: unstubbed,
        renameBranch: unstubbed,
        remoteBranchExists: unstubbed,
        resolveRemoteTrackingCommit: unstubbed,
        fetchRemoteBranch: unstubbed,
        fetchRemoteTrackingBranch: unstubbed,
        resolvePrimaryRemoteName: unstubbed,
        resolveDefaultBranchName: unstubbed,
        fetchRemote: unstubbed,
        remoteExists: unstubbed,
        fetchPullRequestHeadCommit: unstubbed,
        resolveCommit: unstubbed,
        refreshCheckedOutBranch: unstubbed,
        ensureRemote: unstubbed,
        listRefs: unstubbed,
        pullCurrentBranch: unstubbed,
        createWorktree: unstubbed,
        fetchPullRequestBranch: unstubbed,
        readRangeContext: unstubbed,
        getReviewDiffPreview: unstubbed,
        getReviewDiffFileContents: unstubbed,
        readConfigValue: unstubbed,
        statusDetailsRemote: unstubbed,
        prepareCommitContext: unstubbed,
        commit: unstubbed,
        pushCurrentBranch: unstubbed,
        execute: unstubbed,
        status: unstubbed,
        statusDetails: unstubbed,
        statusDetailsLocal: unstubbed,
      }),
    ),
    Layer.provide(
      mockService(GitManager.GitManager)({
        preparePullRequestThread: unstubbed,
        runStackedAction: unstubbed,
        invalidateLocalStatus: unstubbed,
        invalidateRemoteStatus: unstubbed,
        invalidateStatus: unstubbed,
        resolvePullRequest: unstubbed,
        status: unstubbed,
        localStatus: unstubbed,
        remoteStatus: unstubbed,
        branchPullRequest: unstubbed,
      }),
    ),
  );
}

describe("GitWorkflowService", () => {
  it.effect("returns an empty local status when no VCS repository is detected", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const status = yield* workflow.localStatus({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(status, {
        isRepo: false,
        hasPrimaryRemote: false,
        isDefaultRef: false,
        refName: null,
        hasWorkingTreeChanges: false,
        workingTree: {
          files: [],
          insertions: 0,
          deletions: 0,
        },
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.succeed(null),
        }),
      ),
    ),
  );

  it.effect("returns an empty full status when no VCS repository is detected", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const status = yield* workflow.status({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(status, {
        isRepo: false,
        hasPrimaryRemote: false,
        isDefaultRef: false,
        refName: null,
        hasWorkingTreeChanges: false,
        workingTree: {
          files: [],
          insertions: 0,
          deletions: 0,
        },
        hasUpstream: false,
        aheadCount: 0,
        behindCount: 0,
        aheadOfDefaultCount: 0,
        pr: null,
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.succeed(null),
        }),
      ),
    ),
  );

  it.effect("does not call GitManager status methods when no VCS repository is detected", () => {
    const localStatus = vi.fn();
    const remoteStatus = vi.fn();
    const status = vi.fn();

    const testLayer = GitWorkflowService.layer.pipe(
      Layer.provide(
        mockService(VcsDriverRegistry.VcsDriverRegistry)({
          get: unstubbed,
          resolve: unstubbed,
          detect: () => Effect.succeed(null),
        }),
      ),
      Layer.provide(
        mockService(GitVcsDriver.GitVcsDriver)({
          createRef: unstubbed,
          switchRef: unstubbed,
          initRepo: unstubbed,
          listLocalBranchNames: unstubbed,
          setBranchUpstream: unstubbed,
          removeWorktree: unstubbed,
          pruneWorktrees: unstubbed,
          renameBranch: unstubbed,
          remoteBranchExists: unstubbed,
          resolveRemoteTrackingCommit: unstubbed,
          fetchRemoteBranch: unstubbed,
          fetchRemoteTrackingBranch: unstubbed,
          resolvePrimaryRemoteName: unstubbed,
          resolveDefaultBranchName: unstubbed,
          fetchRemote: unstubbed,
          remoteExists: unstubbed,
          fetchPullRequestHeadCommit: unstubbed,
          resolveCommit: unstubbed,
          refreshCheckedOutBranch: unstubbed,
          ensureRemote: unstubbed,
          listRefs: unstubbed,
          pullCurrentBranch: unstubbed,
          createWorktree: unstubbed,
          fetchPullRequestBranch: unstubbed,
          readRangeContext: unstubbed,
          getReviewDiffPreview: unstubbed,
          getReviewDiffFileContents: unstubbed,
          readConfigValue: unstubbed,
          statusDetailsRemote: unstubbed,
          prepareCommitContext: unstubbed,
          commit: unstubbed,
          pushCurrentBranch: unstubbed,
          execute: unstubbed,
          status: unstubbed,
          statusDetails: unstubbed,
          statusDetailsLocal: unstubbed,
        }),
      ),
      Layer.provide(
        mockService(GitManager.GitManager)({
          resolvePullRequest: unstubbed,
          preparePullRequestThread: unstubbed,
          runStackedAction: unstubbed,
          branchPullRequest: unstubbed,
          invalidateLocalStatus: unstubbed,
          invalidateRemoteStatus: unstubbed,
          invalidateStatus: unstubbed,
          localStatus,
          remoteStatus,
          status,
        }),
      ),
    );

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      yield* workflow.localStatus({ cwd: "/not-a-repo" });
      yield* workflow.remoteStatus({ cwd: "/not-a-repo" });
      yield* workflow.status({ cwd: "/not-a-repo" });

      assert.equal(localStatus.mock.calls.length, 0);
      assert.equal(remoteStatus.mock.calls.length, 0);
      assert.equal(status.mock.calls.length, 0);
    }).pipe(Effect.provide(testLayer));
  });

  it.effect("returns an empty ref list when no VCS repository is detected", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const refs = yield* workflow.listRefs({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(refs, {
        refs: [],
        isRepo: false,
        hasPrimaryRemote: false,
        nextCursor: null,
        totalCount: 0,
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.succeed(null),
        }),
      ),
    ),
  );

  it.effect("structures workflow detection failures without exposing upstream details", () => {
    const cause = new VcsRepositoryDetectionError({
      operation: "VcsDriverRegistry.detect",
      cwd: "/repo",
      detail: "upstream detail must stay in the cause chain",
    });

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const error = yield* workflow.status({ cwd: "/repo" }).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "GitManagerError",
        operation: "GitWorkflowService.status",
        cwd: "/repo",
        detail: "Failed to detect a VCS repository for this Git workflow.",
      });
      expect(error.message).not.toContain(cause.detail);
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.fail(cause),
        }),
      ),
    );
  });

  it.effect("structures command detection failures without exposing upstream details", () => {
    const cause = new VcsRepositoryDetectionError({
      operation: "VcsDriverRegistry.detect",
      cwd: "/repo",
      detail: "upstream command detail must stay in the cause chain",
    });

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const error = yield* workflow.listRefs({ cwd: "/repo" }).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "GitCommandError",
        operation: "GitWorkflowService.listRefs",
        command: "vcs-route",
        cwd: "/repo",
        detail: "Failed to detect a VCS repository for this Git command.",
      });
      expect(error.message).not.toContain(cause.detail);
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.fail(cause),
        }),
      ),
    );
  });
});
