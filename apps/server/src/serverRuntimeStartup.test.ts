import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CLAUDE_DRIVER_KIND,
  DEFAULT_MODEL,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  defaultInstanceIdForDriver,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as ServerConfig from "./config.ts";
import * as HierarchySeeder from "./orchestration/HierarchySeeder.ts";
import * as OrchestrationEngine from "./orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerRuntimeStartup from "./serverRuntimeStartup.ts";
import * as ServerSettings from "./serverSettings.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";

it.effect("automatic pull only updates enabled, behind, clean default-branch checkouts", () =>
  Effect.gen(function* () {
    const pulled: string[] = [];
    const git = {
      statusDetails: (cwd: string) =>
        Effect.succeed({
          isRepo: true,
          isDefaultBranch: cwd !== "/feature",
          hasUpstream: true,
          hasWorkingTreeChanges: cwd === "/dirty",
          aheadCount: cwd === "/ahead" ? 1 : 0,
          behindCount: cwd === "/current" ? 0 : 1,
        } as never),
      pullCurrentBranch: (cwd: string) =>
        Effect.sync(() => {
          pulled.push(cwd);
          return {
            status: "pulled" as const,
            refName: "main",
            upstreamRef: "origin/main",
          };
        }),
    } as unknown as GitVcsDriver.GitVcsDriver["Service"];
    const project = (workspaceRoot: string, autoPull = true) =>
      ({ id: ProjectId.make(workspaceRoot), workspaceRoot, autoPull }) as never;

    yield* ServerRuntimeStartup.autoPullProjects([
      project("/clean"),
      project("/current"),
      project("/dirty"),
      project("/ahead"),
      project("/feature"),
      project("/disabled", false),
    ]).pipe(Effect.provideService(GitVcsDriver.GitVcsDriver, git));

    assert.deepStrictEqual(pulled, ["/clean"]);

    pulled.length = 0;
    yield* ServerRuntimeStartup.autoPullProjects(
      [project("/inherited", false), project("/opted-out"), project("/dirty", false)],
      {
        defaultAutoPull: true,
        projectAutoPullOverrides: { [ProjectId.make("/opted-out")]: false },
      },
    ).pipe(Effect.provideService(GitVcsDriver.GitVcsDriver, git));
    assert.deepStrictEqual(pulled, ["/inherited"]);
  }),
);

it.effect("enqueueCommand waits for readiness and then drains queued work", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const executionCount = yield* Ref.make(0);
      const commandGate = yield* ServerRuntimeStartup.makeCommandGate;

      const queuedCommandFiber = yield* commandGate
        .enqueueCommand(Ref.updateAndGet(executionCount, (count) => count + 1))
        .pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      assert.equal(yield* Ref.get(executionCount), 0);

      yield* commandGate.signalCommandReady;

      const result = yield* Fiber.join(queuedCommandFiber);
      assert.equal(result, 1);
      assert.equal(yield* Ref.get(executionCount), 1);
    }),
  ),
);

it.effect("enqueueCommand fails queued work when readiness fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const commandGate = yield* ServerRuntimeStartup.makeCommandGate;
      const failure = yield* Deferred.make<void, never>();

      const queuedCommandFiber = yield* commandGate
        .enqueueCommand(Deferred.await(failure).pipe(Effect.as("should-not-run")))
        .pipe(Effect.forkScoped);

      yield* commandGate.failCommandReady(
        new ServerRuntimeStartup.ServerRuntimeStartupError({
          mode: "web",
          host: "127.0.0.1",
          port: 3773,
          cause: new Error("test startup failure"),
        }),
      );

      const error = yield* Effect.flip(Fiber.join(queuedCommandFiber));
      assert.equal(error.message, "Server runtime startup failed before command readiness.");
    }),
  ),
);

it.effect("resolveWelcomeBase derives cwd and project name from server config", () =>
  Effect.gen(function* () {
    const welcome = yield* ServerRuntimeStartup.resolveWelcomeBase.pipe(
      Effect.provideService(ServerConfig.ServerConfig, {
        cwd: "/tmp/startup-project",
      } as never),
    );

    assert.deepStrictEqual(welcome, {
      cwd: "/tmp/startup-project",
      projectName: "startup-project",
    });
  }),
);

it.effect("resolveAutoBootstrapWelcomeTargets returns existing project and thread ids", () => {
  const bootstrapProjectId = ProjectId.make("project-startup-bootstrap");
  const bootstrapThreadId = ThreadId.make("thread-startup-bootstrap");

  return Effect.gen(function* () {
    const dispatchCalls = yield* Ref.make<ReadonlyArray<string>>([]);
    const targets = yield* ServerRuntimeStartup.resolveAutoBootstrapWelcomeTargets.pipe(
      Effect.provide(ServerSettings.layerTest()),
      Effect.provideService(ServerConfig.ServerConfig, {
        cwd: "/tmp/startup-project",
        autoBootstrapProjectFromCwd: true,
      } as never),
      Effect.provideService(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
        getUserInputActivity: () => Effect.die("unused"),
        getCommandReadModel: () => Effect.die("unused"),
        getSnapshot: () => Effect.die("unused"),
        getShellSnapshot: () => Effect.die("unused"),
        getArchivedShellSnapshot: () => Effect.die("unused"),
        getSnapshotSequence: () => Effect.die("unused"),
        getCounts: () => Effect.die("unused"),
        getEventReplayStats: () => Effect.die("unused"),
        getActiveProjectByWorkspaceRoot: () =>
          Effect.succeed(
            Option.some({
              id: bootstrapProjectId,
              title: "Startup Project",
              workspaceRoot: "/tmp/startup-project",
              defaultModelSelection: {
                instanceId: ProviderInstanceId.make("codex"),
                model: DEFAULT_MODEL,
              },
              scripts: [],
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              deletedAt: null,
            }),
          ),
        getProjectShellById: () => Effect.die("unused"),
        getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.some(bootstrapThreadId)),
        getImportedAgentSessionSources: () => Effect.die("unused"),
        getThreadCheckpointContext: () => Effect.succeed(Option.none()),
        getFullThreadDiffContext: () => Effect.succeed(Option.none()),
        getThreadRuntimeContext: () => Effect.die("unused"),
        getTurnStartMessage: () => Effect.die("unused"),
        getThreadShellById: () => Effect.die("unused"),
        getThreadDetailById: () => Effect.die("unused"),
        getThreadDetailSnapshot: () => Effect.die("unused"),
        searchThreads: () => Effect.succeed({ matches: [] }),
      }),
      Effect.provideService(OrchestrationEngine.OrchestrationEngineService, {
        readEvents: () => Stream.empty,
        readThreadEvents: () => Stream.empty,
        getThreadReplayStats: () => Effect.die("unused thread replay stats"),
        dispatch: (command) =>
          Ref.update(dispatchCalls, (calls) => [...calls, command.type]).pipe(
            Effect.as({ sequence: 1 }),
          ),
        streamDomainEvents: Stream.empty,
        subscribeDomainEvents: Effect.succeed(Stream.empty),
        latestSequence: Effect.succeed(0),
      } satisfies OrchestrationEngine.OrchestrationEngineService["Service"]),
      Effect.provide(NodeServices.layer),
    );

    assert.deepStrictEqual(targets, {
      bootstrapProjectId,
      bootstrapThreadId,
      bootstrapProjectCreated: false,
      bootstrapThreadCreated: false,
    });
    assert.deepStrictEqual(yield* Ref.get(dispatchCalls), []);
  });
});

it.effect.each([
  { existing: false, machineModel: null, projectModel: null },
  { existing: false, machineModel: "claude-sonnet-4-6", projectModel: null },
  { existing: true, machineModel: "claude-sonnet-4-6", projectModel: null },
  { existing: true, machineModel: "claude-sonnet-4-6", projectModel: "gpt-5.4" },
])("auto-bootstrap model precedence: %j", ({ existing, machineModel, projectModel }) =>
  Effect.gen(function* () {
    const machineSelection = machineModel
      ? { instanceId: ProviderInstanceId.make("claude-code"), model: machineModel }
      : null;
    const projectSelection = projectModel
      ? { instanceId: ProviderInstanceId.make("codex"), model: projectModel }
      : null;
    const dispatchCalls = yield* Ref.make<
      ReadonlyArray<{
        readonly type: string;
        readonly defaultModelSelection?: unknown;
        readonly modelSelection?: unknown;
      }>
    >([]);
    const targets = yield* ServerRuntimeStartup.resolveAutoBootstrapWelcomeTargets.pipe(
      Effect.provide(ServerSettings.layerTest({ defaultModelSelection: machineSelection })),
      Effect.provideService(ServerConfig.ServerConfig, {
        cwd: "/tmp/startup-project",
        autoBootstrapProjectFromCwd: true,
      } as never),
      Effect.provideService(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
        getUserInputActivity: () => Effect.die("unused"),
        getCommandReadModel: () => Effect.die("unused"),
        getSnapshot: () => Effect.die("unused"),
        getShellSnapshot: () => Effect.die("unused"),
        getArchivedShellSnapshot: () => Effect.die("unused"),
        getSnapshotSequence: () => Effect.die("unused"),
        getCounts: () => Effect.die("unused"),
        getEventReplayStats: () => Effect.die("unused"),
        getActiveProjectByWorkspaceRoot: () =>
          Effect.succeed(
            existing
              ? Option.some({
                  id: ProjectId.make("existing-project"),
                  title: "Startup Project",
                  workspaceRoot: "/tmp/startup-project",
                  defaultModelSelection: projectSelection,
                  scripts: [],
                  createdAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: "2026-01-01T00:00:00.000Z",
                  deletedAt: null,
                })
              : Option.none(),
          ),
        getProjectShellById: () => Effect.die("unused"),
        getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
        getImportedAgentSessionSources: () => Effect.die("unused"),
        getThreadCheckpointContext: () => Effect.succeed(Option.none()),
        getFullThreadDiffContext: () => Effect.succeed(Option.none()),
        getThreadRuntimeContext: () => Effect.die("unused"),
        getTurnStartMessage: () => Effect.die("unused"),
        getThreadShellById: () => Effect.die("unused"),
        getThreadDetailById: () => Effect.die("unused"),
        getThreadDetailSnapshot: () => Effect.die("unused"),
        searchThreads: () => Effect.succeed({ matches: [] }),
      }),
      Effect.provideService(OrchestrationEngine.OrchestrationEngineService, {
        readEvents: () => Stream.empty,
        readThreadEvents: () => Stream.empty,
        getThreadReplayStats: () => Effect.die("unused thread replay stats"),
        dispatch: (command) =>
          Ref.update(dispatchCalls, (calls) => [...calls, command]).pipe(
            Effect.as({ sequence: 1 }),
          ),
        streamDomainEvents: Stream.empty,
        subscribeDomainEvents: Effect.succeed(Stream.empty),
        latestSequence: Effect.succeed(0),
      } satisfies OrchestrationEngine.OrchestrationEngineService["Service"]),
      Effect.provide(NodeServices.layer),
    );

    assert.equal(typeof targets.bootstrapProjectId, "string");
    assert.equal(typeof targets.bootstrapThreadId, "string");
    assert.equal(targets.bootstrapProjectCreated, !existing);
    assert.equal(targets.bootstrapThreadCreated, true);
    const commands = yield* Ref.get(dispatchCalls);
    assert.deepStrictEqual(
      commands.map((command) => command.type),
      existing ? ["thread.create"] : ["project.create", "thread.create"],
    );
    if (!existing) assert.equal("defaultModelSelection" in commands[0]!, false);
    assert.deepStrictEqual(
      commands.at(-1)?.modelSelection,
      projectSelection ??
        machineSelection ?? {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_MODEL,
        },
    );
  }),
);

it.effect(
  "resolveAutoBootstrapWelcomeTargets preserves a project created before thread failure",
  () =>
    Effect.gen(function* () {
      const dispatchCalls = yield* Ref.make<ReadonlyArray<string>>([]);
      const targets = yield* ServerRuntimeStartup.resolveAutoBootstrapWelcomeTargets.pipe(
        Effect.provide(ServerSettings.layerTest()),
        Effect.provideService(ServerConfig.ServerConfig, {
          cwd: "/tmp/startup-project",
          autoBootstrapProjectFromCwd: true,
        } as never),
        Effect.provideService(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
          getUserInputActivity: () => Effect.die("unused"),
          getCommandReadModel: () => Effect.die("unused"),
          getSnapshot: () => Effect.die("unused"),
          getShellSnapshot: () => Effect.die("unused"),
          getArchivedShellSnapshot: () => Effect.die("unused"),
          getSnapshotSequence: () => Effect.die("unused"),
          getCounts: () => Effect.die("unused"),
          getEventReplayStats: () => Effect.die("unused"),
          getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
          getProjectShellById: () => Effect.die("unused"),
          getFirstActiveThreadIdByProjectId: () => Effect.die("thread lookup failed"),
          getImportedAgentSessionSources: () => Effect.die("unused"),
          getThreadCheckpointContext: () => Effect.succeed(Option.none()),
          getFullThreadDiffContext: () => Effect.succeed(Option.none()),
          getThreadRuntimeContext: () => Effect.die("unused"),
          getTurnStartMessage: () => Effect.die("unused"),
          getThreadShellById: () => Effect.die("unused"),
          getThreadDetailById: () => Effect.die("unused"),
          getThreadDetailSnapshot: () => Effect.die("unused"),
          searchThreads: () => Effect.succeed({ matches: [] }),
        }),
        Effect.provideService(OrchestrationEngine.OrchestrationEngineService, {
          readEvents: () => Stream.empty,
          readThreadEvents: () => Stream.empty,
          getThreadReplayStats: () => Effect.die("unused thread replay stats"),
          dispatch: (command) =>
            Ref.update(dispatchCalls, (calls) => [...calls, command.type]).pipe(
              Effect.as({ sequence: 1 }),
            ),
          streamDomainEvents: Stream.empty,
          subscribeDomainEvents: Effect.succeed(Stream.empty),
          latestSequence: Effect.succeed(0),
        } satisfies OrchestrationEngine.OrchestrationEngineService["Service"]),
        Effect.provide(NodeServices.layer),
      );

      assert.equal(typeof targets.bootstrapProjectId, "string");
      assert.equal(targets.bootstrapProjectCreated, true);
      assert.equal(targets.bootstrapThreadId, undefined);
      assert.equal(targets.bootstrapThreadCreated, undefined);
      assert.deepStrictEqual(yield* Ref.get(dispatchCalls), ["project.create"]);
    }),
);

it.effect("resolveAutoBootstrapWelcomeTargets preserves typed UUID generation failures", () =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const uuidError = PlatformError.systemError({
      _tag: "Unknown",
      module: "Crypto",
      method: "randomUUIDv4",
      description: "UUID generation unavailable",
    });
    const dispatchCalls = yield* Ref.make<ReadonlyArray<string>>([]);

    const error = yield* ServerRuntimeStartup.resolveAutoBootstrapWelcomeTargets.pipe(
      Effect.provide(ServerSettings.layerTest()),
      Effect.provideService(ServerConfig.ServerConfig, {
        cwd: "/tmp/startup-project",
        autoBootstrapProjectFromCwd: true,
      } as never),
      Effect.provideService(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
        getUserInputActivity: () => Effect.die("unused"),
        getCommandReadModel: () => Effect.die("unused"),
        getSnapshot: () => Effect.die("unused"),
        getShellSnapshot: () => Effect.die("unused"),
        getArchivedShellSnapshot: () => Effect.die("unused"),
        getSnapshotSequence: () => Effect.die("unused"),
        getCounts: () => Effect.die("unused"),
        getEventReplayStats: () => Effect.die("unused"),
        getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
        getProjectShellById: () => Effect.die("unused"),
        getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
        getImportedAgentSessionSources: () => Effect.die("unused"),
        getThreadCheckpointContext: () => Effect.succeed(Option.none()),
        getFullThreadDiffContext: () => Effect.succeed(Option.none()),
        getThreadRuntimeContext: () => Effect.die("unused"),
        getTurnStartMessage: () => Effect.die("unused"),
        getThreadShellById: () => Effect.die("unused"),
        getThreadDetailById: () => Effect.die("unused"),
        getThreadDetailSnapshot: () => Effect.die("unused"),
        searchThreads: () => Effect.succeed({ matches: [] }),
      }),
      Effect.provideService(OrchestrationEngine.OrchestrationEngineService, {
        readEvents: () => Stream.empty,
        readThreadEvents: () => Stream.empty,
        getThreadReplayStats: () => Effect.die("unused thread replay stats"),
        dispatch: (command) =>
          Ref.update(dispatchCalls, (calls) => [...calls, command.type]).pipe(
            Effect.as({ sequence: 1 }),
          ),
        streamDomainEvents: Stream.empty,
        subscribeDomainEvents: Effect.succeed(Stream.empty),
        latestSequence: Effect.succeed(0),
      } satisfies OrchestrationEngine.OrchestrationEngineService["Service"]),
      Effect.provideService(Crypto.Crypto, {
        ...crypto,
        randomUUIDv4: Effect.fail(uuidError),
      }),
      Effect.flip,
    );

    assert.strictEqual(error, uuidError);
    assert.deepStrictEqual(yield* Ref.get(dispatchCalls), []);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("completeAutoBootstrapWelcome settles failures without bootstrap targets", () =>
  Effect.gen(function* () {
    const completion = yield* ServerRuntimeStartup.completeAutoBootstrapWelcome(
      Effect.fail("bootstrap failed"),
    );

    assert.deepStrictEqual(completion, { bootstrapStatus: "complete" });
  }),
);

it.effect("completeAutoBootstrapWelcome settles unexpected defects", () =>
  Effect.gen(function* () {
    const completion = yield* ServerRuntimeStartup.completeAutoBootstrapWelcome(
      Effect.die("bootstrap defect"),
    );

    assert.deepStrictEqual(completion, { bootstrapStatus: "complete" });
  }),
);

it.effect("completeAutoBootstrapWelcome settles an empty bootstrap result", () =>
  Effect.gen(function* () {
    const completion = yield* ServerRuntimeStartup.completeAutoBootstrapWelcome(Effect.succeed({}));

    assert.deepStrictEqual(completion, { bootstrapStatus: "complete" });
  }),
);

/**
 * A projection surface with the two methods the seed reads.
 *
 * Spelling out the other twenty-one `Effect.die("unused")` entries would say nothing these two
 * lines do not. Anything else the seeder reaches for throws rather than returning a plausible
 * stub — which is how the instance repair's new read was caught here rather than in review.
 */
const seedProjections = (
  getActiveProjectByWorkspaceRoot: ProjectionSnapshotQuery.ProjectionSnapshotQuery["Service"]["getActiveProjectByWorkspaceRoot"],
) =>
  ({
    getActiveProjectByWorkspaceRoot,
    // The seeder reads the command read model to find seeded threads whose provider instance
    // predates the driver-kind fix (`t3_bot-p4u`). THE THREE THREADS, CARRYING THE RIGHT
    // INSTANCE, because that is the branch a fresh boot takes: the creates above the read make
    // their rows visible to it, so `existing` is defined and the OLD-VALUE GUARD is what skips
    // the repair. An empty list skips it by the `existing === undefined` branch instead — a
    // different line, and one that leaves this test green with the old-value guard deleted.
    getCommandReadModel: () =>
      Effect.succeed({
        threads: HierarchySeeder.__testing.SEEDED_THREADS.map((thread) => ({
          id: thread.id,
          modelSelection: { instanceId: defaultInstanceIdForDriver(CLAUDE_DRIVER_KIND) },
        })),
      }),
  }) as never;

const seedEngine = (
  dispatch: OrchestrationEngine.OrchestrationEngineService["Service"]["dispatch"],
) => ({ dispatch }) as never;

it.effect("the hierarchy seed is pointed at the server's own workspace root", () =>
  Effect.gen(function* () {
    const dispatched = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([]);
    const rootsRead = yield* Ref.make<ReadonlyArray<string>>([]);

    yield* ServerRuntimeStartup.seedHierarchyIfEnabled.pipe(
      Effect.provideService(ServerConfig.ServerConfig, {
        cwd: "/tmp/startup-project",
        noSeedHierarchy: false,
      } as never),
      Effect.provideService(
        ProjectionSnapshotQuery.ProjectionSnapshotQuery,
        seedProjections((workspaceRoot) =>
          Ref.update(rootsRead, (roots) => [...roots, workspaceRoot]).pipe(
            Effect.as(Option.none()),
          ),
        ),
      ),
      Effect.provideService(
        OrchestrationEngine.OrchestrationEngineService,
        seedEngine((command) =>
          Ref.update(dispatched, (commands) => [...commands, command as never]).pipe(
            Effect.as({ sequence: 1 }),
          ),
        ),
      ),
    );

    const commands = yield* Ref.get(dispatched);
    assert.deepStrictEqual(
      commands.map((command) => command["type"]),
      [
        "project.create",
        "thread.create",
        "thread.create",
        "thread.create",
        "channel.create",
        "channel.create",
        // The operator joins #seniors as its own command rather than as an entry
        // in the create's member list, because the receipt short-circuit
        // compares the commandId and never the payload — so editing an
        // already-shipped command's members is a change that silently does not
        // happen on a database that has already booted.
        "channel.member.add",
        // AND NOTHING ELSE. The instance repair must not fire on a fresh seed: its threads
        // were just created with the right instance, so a `thread.meta.update` here would be
        // the seeder re-deciding a command for a thread it had correctly created a moment
        // earlier. Three of them, on every first boot.
      ],
    );

    // WHICH root, not merely that it seeded. The seeder takes a path, and every
    // wrong path available at the call site — baseDir, the state directory, the
    // process cwd of whatever started the server — produces a hierarchy that
    // looks correct and hangs off a project nobody opened.
    assert.equal(commands[0]?.["workspaceRoot"], "/tmp/startup-project");
    assert.deepStrictEqual(yield* Ref.get(rootsRead), ["/tmp/startup-project"]);
  }),
);

it.effect("--no-seed-hierarchy seeds nothing, and does not even look", () =>
  Effect.gen(function* () {
    // Both collaborators die rather than record. An opt-out that still reads the
    // projection has not opted out of anything a reviewer would care about, and
    // a recording stub would let that pass.
    yield* ServerRuntimeStartup.seedHierarchyIfEnabled.pipe(
      Effect.provideService(ServerConfig.ServerConfig, {
        cwd: "/tmp/startup-project",
        noSeedHierarchy: true,
      } as never),
      Effect.provideService(
        ProjectionSnapshotQuery.ProjectionSnapshotQuery,
        seedProjections(() => Effect.die("opted out, yet read the projection")),
      ),
      Effect.provideService(
        OrchestrationEngine.OrchestrationEngineService,
        seedEngine(() => Effect.die("opted out, yet dispatched a command")),
      ),
    );
  }),
);
