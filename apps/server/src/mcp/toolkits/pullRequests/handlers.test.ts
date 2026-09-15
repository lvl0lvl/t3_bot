import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";

import { OrchestrationCommandInvariantError } from "../../../orchestration/Errors.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { listThreadPullRequests, PullRequestsToolkitHandlersLive } from "./handlers.ts";
import { PullRequestLinkFailedError, PullRequestsToolkit } from "./tools.ts";
import { mockService, unstubbed } from "../../../testUtils/mockService.ts";

const PROJECT_ID = ProjectId.make("project-1");
const THREAD_ID = ThreadId.make("thread-1");
// A second token's thread. With every fixture at THREAD_ID, a handler that
// stamps the constant "thread-1" is indistinguishable from one that stamps
// the token's thread; the door tests dispatch once as each.
const OTHER_THREAD_ID = ThreadId.make("thread-2");

const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(7),
  digest: (_algorithm, data) => Effect.succeed(data),
});

const invocation = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability>,
  threadId: ThreadId,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  threadId,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

function makeProject(
  repositoryIdentity: OrchestrationProjectShell["repositoryIdentity"] = {
    canonicalKey: "github.com/t3tools/t3code",
    locator: {
      source: "git-remote",
      remoteName: "origin",
      remoteUrl: "git@github.com:T3Tools/T3Code.git",
    },
    provider: "github",
    displayName: "T3Tools/T3Code",
    owner: "T3Tools",
    name: "T3Code",
  },
): OrchestrationProjectShell {
  return {
    id: PROJECT_ID,
    title: "Project",
    workspaceRoot: "/workspace/project",
    defaultModelSelection: null,
    scripts: [],
    repositoryIdentity,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function makeThread(pullRequests: ReadonlyArray<ThreadPullRequestLink>): OrchestrationThreadShell {
  return {
    id: THREAD_ID,
    projectId: PROJECT_ID,
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequests,
    latestTurn: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: "2026-08-20T00:00:00.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

function makeLink(
  number: number,
  overrides: Partial<ThreadPullRequestLink> & {
    readonly headBranch?: string;
    readonly baseBranch?: string;
  } = {},
): ThreadPullRequestLink {
  const { headBranch, baseBranch, ...rest } = overrides;
  return {
    host: "github.com",
    repository: "t3tools/t3code",
    number,
    url: `https://github.com/t3tools/t3code/pull/${number}`,
    source: "manual",
    linkedAt: "2026-08-10T00:00:00.000Z",
    snapshot:
      headBranch === undefined
        ? null
        : {
            state: "open",
            title: `PR ${number}`,
            headBranch,
            baseBranch: baseBranch ?? "main",
            isDraft: false,
            updatedAt: null,
            syncedAt: "2026-08-27T00:00:00.000Z",
          },
    stack: null,
    ...rest,
  };
}

interface HarnessOptions {
  readonly thread?: OrchestrationThreadShell | null;
  readonly project?: OrchestrationProjectShell | null;
  readonly reject?: (command: OrchestrationCommand) => OrchestrationCommandInvariantError | null;
}

const makeHarness = Effect.fn("makePullRequestsToolkitHarness")(function* (
  options: HarnessOptions = {},
) {
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
  // The WHOLE options object of each dispatch, recorded beside the command —
  // `undefined` when the handler passed none, which is what a bare dispatch
  // reads as. Recording `options?.issuer` alone let an extra `origin` key
  // stamped beside the issuer pass unseen.
  const dispatches = yield* Ref.make<ReadonlyArray<unknown>>([]);
  const thread = options.thread === undefined ? makeThread([]) : options.thread;
  const project = options.project === undefined ? makeProject() : options.project;
  const dispatch: OrchestrationEngineShape["dispatch"] = (command, dispatchOptions) =>
    Effect.gen(function* () {
      const rejection = options.reject?.(command) ?? null;
      if (rejection !== null) return yield* rejection;
      yield* Ref.update(commands, (recorded) => [...recorded, command]);
      yield* Ref.update(dispatches, (recorded) => [...recorded, dispatchOptions]);
      return { sequence: 1 };
    });
  const dependencies = Layer.mergeAll(
    mockService(ProjectionSnapshotQuery)({
      getThreadDetailById: unstubbed,
      getThreadDetailSnapshot: unstubbed,
      getThreadCheckpointContext: unstubbed,
      getFullThreadDiffContext: unstubbed,
      getThreadRuntimeContext: unstubbed,
      getTurnStartMessage: unstubbed,
      getEventReplayStats: unstubbed,
      getActiveProjectByWorkspaceRoot: unstubbed,
      getFirstActiveThreadIdByProjectId: unstubbed,
      getImportedAgentSessionSources: unstubbed,
      getArchivedShellSnapshot: unstubbed,
      searchThreads: unstubbed,
      getSnapshotSequence: unstubbed,
      getCounts: unstubbed,
      getUserInputActivity: unstubbed,
      getCommandReadModel: unstubbed,
      getSnapshot: unstubbed,
      getShellSnapshot: unstubbed,
      // The one thread fixture answers for either token id, under that id.
      getThreadShellById: (threadId) =>
        Effect.succeed(
          thread !== null && (threadId === THREAD_ID || threadId === OTHER_THREAD_ID)
            ? Option.some({ ...thread, id: threadId })
            : Option.none(),
        ),
      getProjectShellById: () => Effect.succeed(Option.fromNullishOr(project)),
    }),
    mockService(OrchestrationEngineService)({
      readThreadEvents: unstubbed,
      getThreadReplayStats: unstubbed,
      subscribeDomainEvents: unstubbed,
      readEvents: () => Stream.empty,
      dispatch,
      streamDomainEvents: Stream.empty,
      latestSequence: Effect.succeed(0),
    }),
    Layer.succeed(Crypto.Crypto, testCrypto),
  );
  const toolkit = yield* PullRequestsToolkit.pipe(
    Effect.provide(PullRequestsToolkitHandlersLive.pipe(Layer.provide(dependencies))),
  );
  const call = <Name extends keyof typeof PullRequestsToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
    capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["pull-requests"],
    threadId: ThreadId = THREAD_ID,
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      // Failure mode is "error", so a delivered result is always the success shape.
      Effect.map(
        (chunk) => chunk.at(-1)!.result as Tool.Success<(typeof PullRequestsToolkit.tools)[Name]>,
      ),
      Effect.provideService(
        McpInvocationContext.McpInvocationContext,
        invocation(capabilities, threadId),
      ),
      Effect.provide(dependencies),
    );
  return { commands, dispatches, call };
});

describe("pull request toolkit handlers", () => {
  it.effect("refuses a credential without the pull-requests capability", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness
        .call("list_thread_pull_requests", {}, ["preview"])
        .pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "McpCapabilityUnavailableError",
        capability: "pull-requests",
        threadId: THREAD_ID,
      });
      expect(yield* Ref.get(harness.commands)).toEqual([]);
    }),
  );

  it.effect("links by URL with source agent on the token's thread", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("link_pull_request", {
        url: "https://github.com/T3Tools/T3Code/pull/123/files",
      });
      expect(result).toEqual({
        host: "github.com",
        repository: "t3tools/t3code",
        number: 123,
        url: "https://github.com/T3Tools/T3Code/pull/123/files",
        alreadyLinked: false,
      });
      expect(yield* Ref.get(harness.commands)).toMatchObject([
        {
          type: "thread.pull-request.link",
          threadId: THREAD_ID,
          host: "github.com",
          repository: "t3tools/t3code",
          number: 123,
          source: "agent",
        },
      ]);
    }),
  );

  it.effect("issues a link as the token's thread, not bare", () =>
    Effect.gen(function* () {
      // THE DOOR TEST. This toolkit dispatched with no issuer, and nothing refused
      // it because no pull-request command has an issuer invariant yet. Two tokens
      // on two threads: the issuer must be each token's own thread, so a constant
      // `memberId` fails on the second dispatch. `undefined` in `dispatches` is what
      // the bare dispatch recorded; an extra key beside the issuer fails the strict
      // comparison.
      const harness = yield* makeHarness();
      const params = { url: "https://github.com/T3Tools/T3Code/pull/123" };
      yield* harness.call("link_pull_request", params);
      yield* harness.call("link_pull_request", params, ["pull-requests"], OTHER_THREAD_ID);
      const dispatches = yield* Ref.get(harness.dispatches);
      expect(dispatches).toStrictEqual([
        { issuer: { memberKind: "thread", memberId: THREAD_ID } },
        { issuer: { memberKind: "thread", memberId: OTHER_THREAD_ID } },
      ]);
      expect(dispatches.map((options) => Object.keys(options as object))).toEqual([
        ["issuer"],
        ["issuer"],
      ]);
    }),
  );

  it.effect("issues an unlink as the token's thread, not bare", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ thread: makeThread([makeLink(5)]) });
      const params = { repository: "t3tools/t3code", number: 5 };
      yield* harness.call("unlink_pull_request", params);
      yield* harness.call("unlink_pull_request", params, ["pull-requests"], OTHER_THREAD_ID);
      const dispatches = yield* Ref.get(harness.dispatches);
      expect(dispatches).toStrictEqual([
        { issuer: { memberKind: "thread", memberId: THREAD_ID } },
        { issuer: { memberKind: "thread", memberId: OTHER_THREAD_ID } },
      ]);
      expect(dispatches.map((options) => Object.keys(options as object))).toEqual([
        ["issuer"],
        ["issuer"],
      ]);
    }),
  );

  it.effect("links by repository and number, defaulting the host to the project's", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("link_pull_request", {
        repository: "T3Tools/Other",
        number: 7,
      });
      expect(result).toEqual({
        host: "github.com",
        repository: "t3tools/other",
        number: 7,
        url: "https://github.com/t3tools/other/pull/7",
        alreadyLinked: false,
      });
    }),
  );

  it.effect("builds the URL in the project host's own shape", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        project: makeProject({
          canonicalKey: "gitlab.com/group/sub/project",
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "git@gitlab.com:group/sub/project.git",
          },
          provider: "gitlab",
          displayName: "group/sub/project",
        }),
      });
      const result = yield* harness.call("link_pull_request", {
        repository: "group/sub/project",
        number: 42,
      });
      expect(result.url).toBe("https://gitlab.com/group/sub/project/-/merge_requests/42");
      expect(result.host).toBe("gitlab.com");
    }),
  );

  it.effect("rejects a target that names neither a URL nor repository and number", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness
        .call("link_pull_request", { repository: "x/y" })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "PullRequestTargetIncompleteError" });
      const unknown = yield* harness
        .call("link_pull_request", {
          url: "https://github.com/t3tools/t3code/issues/1?token=private-value",
        })
        .pipe(Effect.flip);
      expect(unknown).toMatchObject({ _tag: "PullRequestUrlInvalidError" });
      expect(unknown.message).not.toContain("private-value");
      expect(yield* Ref.get(harness.commands)).toEqual([]);
    }),
  );

  it.effect("treats a duplicate link as alreadyLinked rather than an error", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        thread: makeThread([makeLink(123)]),
        reject: (command) =>
          command.type === "thread.pull-request.link"
            ? new OrchestrationCommandInvariantError({
                commandType: command.type,
                detail: "already linked",
                reason: { _tag: "pull-request-already-linked" },
              })
            : null,
      });
      const result = yield* harness.call("link_pull_request", {
        url: "https://github.com/t3tools/t3code/pull/123",
      });
      expect(result.alreadyLinked).toBe(true);
    }),
  );

  it.effect("reports any other refusal of a link as a failure, not as alreadyLinked", () =>
    Effect.gen(function* () {
      // THE INPUT THAT BROKE THE OLD CATCH: a refusal that is not the duplicate —
      // untagged here, as a missing thread or a future issuer invariant would
      // be. Until `t3_bot-9dp` it read as `alreadyLinked: true`, and the agent
      // was told it had a link it never got.
      const harness = yield* makeHarness({
        reject: (command) =>
          command.type === "thread.pull-request.link"
            ? new OrchestrationCommandInvariantError({
                commandType: command.type,
                detail: "thread not found",
              })
            : null,
      });
      const error = yield* harness
        .call("link_pull_request", { url: "https://github.com/t3tools/t3code/pull/123" })
        .pipe(Effect.flip);
      expect(error._tag).toBe("PullRequestLinkFailedError");
      // The untagged fixture alone lets a predicate that accepts ANY tagged
      // refusal pass; a refusal tagged with the OTHER door's tag is the input
      // that breaks it.
      const wrongTag = yield* makeHarness({
        reject: (command) =>
          command.type === "thread.pull-request.link"
            ? new OrchestrationCommandInvariantError({
                commandType: command.type,
                detail: "not linked",
                reason: { _tag: "pull-request-not-linked" },
              })
            : null,
      });
      const tagged = yield* wrongTag
        .call("link_pull_request", { url: "https://github.com/t3tools/t3code/pull/123" })
        .pipe(Effect.flip);
      expect(tagged._tag).toBe("PullRequestLinkFailedError");
    }),
  );

  it.effect("reports any other refusal of an unlink as a failure, not as wasLinked=false", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        thread: makeThread([makeLink(5)]),
        reject: (command) =>
          command.type === "thread.pull-request.unlink"
            ? new OrchestrationCommandInvariantError({
                commandType: command.type,
                detail: "thread archived",
                // A tag the unlink does not answer from is still "some other refusal".
                reason: { _tag: "channel-archived" },
              })
            : null,
      });
      const error = yield* harness
        .call("unlink_pull_request", { repository: "t3tools/t3code", number: 5 })
        .pipe(Effect.flip);
      expect(error._tag).toBe("PullRequestUnlinkFailedError");
      // The wrong-tagged fixture alone lets a predicate that also accepts an
      // UNTAGGED refusal pass; an untagged one is the input that breaks it.
      const untagged = yield* makeHarness({
        thread: makeThread([makeLink(5)]),
        reject: (command) =>
          command.type === "thread.pull-request.unlink"
            ? new OrchestrationCommandInvariantError({
                commandType: command.type,
                detail: "thread not found",
              })
            : null,
      });
      const bare = yield* untagged
        .call("unlink_pull_request", { repository: "t3tools/t3code", number: 5 })
        .pipe(Effect.flip);
      expect(bare._tag).toBe("PullRequestUnlinkFailedError");
    }),
  );

  it.effect("unlinks a linked pull request and reports a missing one as wasLinked=false", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        thread: makeThread([makeLink(5)]),
        reject: (command) =>
          command.type === "thread.pull-request.unlink" && command.number !== 5
            ? new OrchestrationCommandInvariantError({
                commandType: command.type,
                detail: "not linked",
                reason: { _tag: "pull-request-not-linked" },
              })
            : null,
      });
      const linked = yield* harness.call("unlink_pull_request", {
        repository: "t3tools/t3code",
        number: 5,
      });
      expect(linked).toEqual({
        host: "github.com",
        repository: "t3tools/t3code",
        number: 5,
        wasLinked: true,
      });
      const missing = yield* harness.call("unlink_pull_request", {
        url: "https://github.com/t3tools/t3code/pull/9",
      });
      expect(missing.wasLinked).toBe(false);
      expect(yield* Ref.get(harness.commands)).toMatchObject([
        { type: "thread.pull-request.unlink", number: 5 },
      ]);
    }),
  );

  it.effect("fails cleanly when the token's thread no longer exists", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ thread: null });
      const error = yield* harness.call("list_thread_pull_requests", {}).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "PullRequestThreadNotFoundError", threadId: THREAD_ID });
    }),
  );

  it.effect("lists visible links with host state and derived chain order", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        thread: makeThread([
          makeLink(3, { headBranch: "feat-c", baseBranch: "feat-b", source: "agent" }),
          makeLink(1, { headBranch: "feat-a", baseBranch: "main", source: "created" }),
          makeLink(2, { headBranch: "feat-b", baseBranch: "feat-a", source: "agent" }),
          makeLink(9, { source: "stack-dismissed" }),
          makeLink(10),
        ]),
      });
      const result = yield* harness.call("list_thread_pull_requests", {});
      expect(result.pullRequests.map((entry) => entry.number)).toEqual([3, 1, 2, 10]);
      expect(result.pullRequests[0]).toEqual({
        host: "github.com",
        repository: "t3tools/t3code",
        number: 3,
        url: "https://github.com/t3tools/t3code/pull/3",
        source: "agent",
        state: "open",
        title: "PR 3",
        headBranch: "feat-c",
        baseBranch: "feat-b",
        isDraft: false,
        stack: { kind: "derived", position: 3, size: 3 },
      });
      expect(result.pullRequests[3]).toMatchObject({
        number: 10,
        state: null,
        title: null,
        headBranch: null,
        stack: null,
      });
      expect(result.chains).toEqual([
        { kind: "derived", numbers: [1, 2, 3] },
        { kind: "derived", numbers: [10] },
      ]);
    }),
  );
});

describe("listThreadPullRequests", () => {
  it("reports a native stack position for each member", () => {
    const stack = {
      kind: "native" as const,
      id: "stack-1",
      number: 1,
      url: "https://github.com/t3tools/t3code/stack/1",
      base: "main",
      layers: [
        { number: 1, headBranch: "a", state: "open" as const },
        { number: 2, headBranch: "b", state: "open" as const },
      ],
    };
    const result = listThreadPullRequests({
      pullRequests: [
        makeLink(2, { stack, source: "stack" }),
        makeLink(1, { stack, source: "created" }),
      ],
    });
    expect(result.pullRequests.map((entry) => [entry.number, entry.stack])).toEqual([
      [2, { kind: "native", position: 2, size: 2 }],
      [1, { kind: "native", position: 1, size: 2 }],
    ]);
    expect(result.chains).toEqual([{ kind: "native", numbers: [1, 2] }]);
  });
});

it("keeps failure diagnostics as the cause rather than exposing them in the tool message", () => {
  const cause = new Error("database internals");
  const failure = new PullRequestLinkFailedError({ cause });
  expect(failure.message).toBe("Could not link the pull request.");
  expect(failure.cause).toBe(cause);
});
