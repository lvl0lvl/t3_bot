/**
 * The startup GENERATOR, run for real.
 *
 * Nothing in this repository ran it. `server.test.ts` mocks
 * `ServerRuntimeStartup` wholesale and no test constructed its layer, so
 * deleting any of its twelve phases was invisible to the whole suite — a
 * survivor found on PR #12 and recorded as `t3_bot-eb3`. Every phase was wired
 * once and measured nowhere.
 *
 * WHAT MAKES IT CHEAP is that `runStartupPhase` already names each phase in a
 * span, `server.startup.<phase>`. A recording tracer turns the phase list into
 * data, so ONE assertion pins all of them and a deleted phase reds it by name.
 * The alternative — a double per phase that records being called — measures the
 * doubles.
 *
 * THE COLLABORATORS ARE DOUBLES, EXCEPT THE ORCHESTRATION STACK. That one is
 * the real engine over a real sqlite file, because "the hierarchy is in the
 * projections" is what is being asserted, and a seed asserted against a fake
 * engine passes for a seeder that dispatched nothing.
 */

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Tracer from "effect/Tracer";
import { HttpServer } from "effect/unstable/http";
import { assert, it } from "@effect/vitest";
import { describe } from "vite-plus/test";

import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import * as ServiceLauncherClient from "./cloud/serviceLauncherClient.ts";
import * as ServerConfig from "./config.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as Keybindings from "./keybindings.ts";
import { OrchestrationEngineLive } from "./orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./orchestration/Layers/ProjectionSnapshotQuery.ts";
import * as OrchestrationReactor from "./orchestration/Services/OrchestrationReactor.ts";
import * as ProjectionSnapshotQuery from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "./orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "./orchestration/ThreadPlanProgress.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "./persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "./persistence/Layers/OrchestrationEventStore.ts";
import { makeSqlitePersistenceLive } from "./persistence/Layers/Sqlite.ts";
import * as ExternalLauncher from "./process/externalLauncher.ts";
import * as ProviderService from "./provider/Services/ProviderService.ts";
import * as ProviderSessionDirectory from "./provider/Services/ProviderSessionDirectory.ts";
import * as ProviderSessionReaper from "./provider/Services/ProviderSessionReaper.ts";
import * as ServerLifecycleEvents from "./serverLifecycleEvents.ts";
import * as ServerRuntimeStartup from "./serverRuntimeStartup.ts";
import * as ServerSettings from "./serverSettings.ts";
import * as AnalyticsService from "./telemetry/AnalyticsService.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";
import * as RepositoryIdentityResolver from "./project/RepositoryIdentityResolver.ts";

/**
 * Span names, collected as they end.
 *
 * Lifted from `RpcInstrumentation.test.ts` rather than reinvented: that is the
 * pattern this repository already uses to assert what a span-annotated effect
 * did.
 */
const recordingTracer = () => {
  const spans: Array<string> = [];
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      const end = span.end.bind(span);
      span.end = (endTime, exit) => {
        end(endTime, exit);
        if (span.sampled) {
          spans.push(span.name);
        }
      };
      return span;
    },
  });
  return { spans, tracer };
};

/**
 * The collaborators the startup generator acquires but whose behaviour is not
 * under test.
 *
 * Every one of these is `as never` on purpose. Spelling out each service's full
 * interface would be a hundred lines of `Effect.die("unused")` that say nothing
 * the shape does not, and it would have to be edited every time an unrelated
 * service grows a method. What startup actually calls on each is one or two
 * members, and those are written out.
 */
const doubles = Layer.mergeAll(
  Layer.succeed(Keybindings.Keybindings, { start: Effect.void } as never),
  Layer.succeed(OrchestrationReactor.OrchestrationReactor, {
    start: () => Effect.void,
  } as never),
  Layer.succeed(ProviderSessionReaper.ProviderSessionReaper, {
    start: () => Effect.void,
  } as never),
  Layer.succeed(ServerLifecycleEvents.ServerLifecycleEvents, {
    publish: () => Effect.void,
  } as never),
  Layer.succeed(ServerEnvironment.ServerEnvironment, {
    getDescriptor: Effect.succeed({ environmentId: "env-harness" }),
  } as never),
  Layer.succeed(ProviderSessionDirectory.ProviderSessionDirectory, {
    listBindings: () => Effect.succeed([]),
  } as never),
  Layer.succeed(ProviderService.ProviderService, {
    listSessions: () => Effect.succeed([]),
  } as never),
  Layer.succeed(ServiceLauncherClient.ServiceLauncherClient, {
    prepareTrial: Effect.succeed(undefined),
  } as never),
  Layer.succeed(AnalyticsService.AnalyticsService, {
    record: () => Effect.void,
  } as never),
  Layer.succeed(EnvironmentAuth.EnvironmentAuth, {
    issueStartupPairingUrl: () => Effect.succeed("http://localhost:0/?token=harness"),
  } as never),
  Layer.succeed(ExternalLauncher.ExternalLauncher, {
    launchBrowser: () => Effect.void,
  } as never),
  // No project has an upstream, so `projects.auto-pull` runs and pulls nothing.
  // It is a double rather than the real driver because the real one would shell
  // out to git in a temp directory.
  Layer.succeed(GitVcsDriver.GitVcsDriver, {
    statusDetails: () => Effect.succeed({ isRepo: false }),
    pullCurrentBranch: () => Effect.die("the harness has nothing to pull"),
  } as never),
  ServerSettings.layerTest(),
  // Never called: `startupPresentation: "browser"` takes the branch that does
  // not build headless access info. It is here because the requirement is on
  // the TYPE of the startup effect, not on the branch taken — the layer has to
  // satisfy every path the generator could run, and the one that wants an HTTP
  // server is the one this config does not take.
  Layer.succeed(HttpServer.HttpServer, {} as never),
);

/**
 * A ServerConfig literal rather than `layerTest`, because the flag under test
 * is one `layerTest` hard-codes.
 *
 * `startupPresentation: "browser"` with `noBrowser: true` is the combination
 * that needs the fewest doubles: the headless branch wants an HTTP server for
 * its access info, and the browser branch returns before it launches anything.
 */
const configLayer = (input: { readonly baseDir: string; readonly noSeedHierarchy: boolean }) =>
  Layer.effect(
    ServerConfig.ServerConfig,
    Effect.gen(function* () {
      const derivedPaths = yield* ServerConfig.deriveServerPaths(input.baseDir, undefined);
      return {
        logLevel: "Warn",
        traceMinLevel: "Info",
        traceTimingEnabled: false,
        traceBatchWindowMs: 200,
        traceMaxBytes: 1024,
        traceMaxFiles: 1,
        otlpTracesUrl: undefined,
        otlpMetricsUrl: undefined,
        otlpExportIntervalMs: 10_000,
        otlpServiceName: "t3-server",
        mode: "web",
        port: 0,
        host: undefined,
        cwd: input.baseDir,
        baseDir: input.baseDir,
        ...derivedPaths,
        staticDir: undefined,
        devUrl: undefined,
        devAllowedOrigins: [],
        noBrowser: true,
        startupPresentation: "browser",
        desktopBootstrapToken: undefined,
        desktopTelemetryFd: undefined,
        desktopTelemetryControlFd: undefined,
        resourceMonitorPath: undefined,
        // OFF, so the only thing that can create a project is the seed. With it
        // on, "a project exists" would be true either way and the seed
        // assertion would pass for the bootstrap's work.
        autoBootstrapProjectFromCwd: false,
        noSeedHierarchy: input.noSeedHierarchy,
        logWebSocketEvents: false,
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      } satisfies ServerConfig.ServerConfig["Service"];
    }),
  );

const startupLayer = (input: {
  readonly databasePath: string;
  readonly baseDir: string;
  readonly noSeedHierarchy: boolean;
}) =>
  ServerRuntimeStartup.layer.pipe(
    Layer.provide(doubles),
    Layer.provideMerge(OrchestrationEngineLive),
    Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
    Layer.provideMerge(OrchestrationProjectionPipelineLive),
    Layer.provideMerge(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provideMerge(OrchestrationEventStoreLive),
    Layer.provideMerge(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provideMerge(makeSqlitePersistenceLive(input.databasePath)),
    Layer.provideMerge(
      configLayer({ baseDir: input.baseDir, noSeedHierarchy: input.noSeedHierarchy }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

/**
 * Boot, wait for the server to accept commands, and read what is there.
 *
 * `awaitCommandReady` is the boundary that matters: it settles at
 * `commandGate.signalCommandReady`, which the generator reaches only after
 * every phase before it has returned. Waiting on a sleep or on a span count
 * would be waiting on the implementation.
 */
const boot = (input: { readonly noSeedHierarchy: boolean }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-startup-harness-" });
    const databasePath = `${baseDir}/state.sqlite`;
    const { spans, tracer } = recordingTracer();

    const readModel = yield* Effect.gen(function* () {
      const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
      yield* startup.markHttpListening;
      yield* startup.awaitCommandReady;
      const projections = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
      return yield* projections.getCommandReadModel();
    }).pipe(
      Effect.provide(
        startupLayer({ databasePath, baseDir, noSeedHierarchy: input.noSeedHierarchy }),
      ),
      Effect.withTracer(tracer),
      Effect.scoped,
    );

    return { readModel, spans };
  }).pipe(Effect.provide(NodeServices.layer));

describe("the startup generator", () => {
  it.effect("seeds the hierarchy and names every phase it ran", () =>
    Effect.gen(function* () {
      const { readModel, spans } = yield* boot({ noSeedHierarchy: false });

      // THE PHASE LIST, which is the assertion this file exists for. Deleting
      // any phase from the generator reds it by name, and so does reordering
      // one past the command-readiness boundary — which is a real change, since
      // a phase after readiness no longer runs before the first client command.
      assert.deepStrictEqual(
        spans.filter((name) => name.startsWith("server.startup.")),
        [
          "server.startup.keybindings.start",
          "server.startup.settings.start",
          "server.startup.reactors.start",
          "server.startup.provider-sessions.reconcile",
          "server.startup.projects.auto-pull",
          "server.startup.hierarchy.seed",
          "server.startup.http.wait",
          "server.startup.auxiliary-roots.parked",
          "server.startup.welcome.publish",
        ],
      );

      // And the hierarchy is actually there, read through the projections
      // rather than from the dispatch: the seed's own tests assert the
      // commands, and this one asserts the state a client would see.
      assert.lengthOf(
        readModel.projects.filter((project) => project.deletedAt === null),
        1,
      );
      assert.deepStrictEqual(readModel.threads.map((thread) => thread.id).sort(), [
        "thread-boss1",
        "thread-boss3",
        "thread-pm",
      ]);
      assert.deepStrictEqual(readModel.channels.map((channel) => channel.name).sort(), [
        "project",
        "seniors",
      ]);
    }),
  );

  it.effect("runs the phase and seeds nothing when the server opted out", () =>
    Effect.gen(function* () {
      const { readModel, spans } = yield* boot({ noSeedHierarchy: true });

      // The PHASE still runs — the check lives inside the effect, not at the
      // call site, so that a test can pin one copy of it. What changes is what
      // it did.
      assert.include(spans, "server.startup.hierarchy.seed");
      assert.lengthOf(readModel.projects, 0);
      assert.lengthOf(readModel.threads, 0);
      assert.lengthOf(readModel.channels, 0);
    }),
  );
});
