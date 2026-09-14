/**
 * What the seed-before-reactors order (`t3_bot-gn4`) is for: a seed that has returned has
 * repaired a seeded thread's row before a reactor started afterwards reads it. A database
 * the OLD seeder wrote (bare `claude` instance) holds one un-consumed post mentioning @pm;
 * the boot under test seeds, then starts MentionWakeReactor, and the engine wrapper reads
 * the thread row at the instant the wake dispatches `thread.turn.start` — the only
 * observation that tells the two orders apart, since the final row is repaired either way.
 *
 * This is the no-`ServerActivation` shape the reactor harnesses run: the root forks and
 * drains at once. It is not a production race — through `makeServerLayer` every reactor
 * root parks behind `ServerActivation`, which the server activates after the seed in either
 * order (`t3_bot-g12`).
 *
 * ProviderCommandReactor is not in this system, so its refusal of the unrepaired id is not
 * executed here; the row the wake handed downstream is the assertion.
 */

import {
  CLAUDE_DRIVER_KIND,
  ChannelMemberHandle,
  ChannelPostId,
  CommandId,
  HUMAN_OPERATOR_MEMBER_ID,
  ProviderInstanceId,
  type OrchestrationCommand,
  defaultInstanceIdForDriver,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vite-plus/test";

import { makeSqlitePersistenceLive } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { ProjectionStateRepository } from "../../persistence/Services/ProjectionState.ts";
import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { ServerConfig } from "../../config.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { MentionWakeBudgetRepositoryLive } from "../../persistence/Layers/MentionWakeBudget.ts";
import { MentionWakeReactor, MENTION_WAKE_CURSOR } from "../Services/MentionWakeReactor.ts";
import { MentionWakeReactorLive } from "./MentionWakeReactor.ts";
import * as HierarchySeeder from "../HierarchySeeder.ts";

const scratchRuntime = ManagedRuntime.make(NodeServices.layer);

const makeScratch = () =>
  scratchRuntime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectory({ prefix: "t3-mention-wake-seed-" });
      return {
        directory,
        databasePath: path.join(directory, "state.sqlite"),
        workspaceRoot: path.join(directory, "repo"),
      };
    }),
  );

const removeDirectory = (directory: string) =>
  scratchRuntime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.remove(directory, { recursive: true });
    }).pipe(Effect.ignore),
  );

const NOW = "2026-01-01T00:00:00.000Z";
const SHIPPED_BAD = "claude";
const REPAIRED = String(defaultInstanceIdForDriver(CLAUDE_DRIVER_KIND));
const WALT = { memberKind: "human", memberId: HUMAN_OPERATOR_MEMBER_ID } as const;
const { SEEDED_THREADS, SEED_ISSUER, SEED_PROJECT_ID, PROJECT_CHANNEL } = HierarchySeeder.__testing;
const PM = SEEDED_THREADS[0];

/**
 * The wake reactor's engine, with the thread row read AT THE DISPATCH. This is the
 * row the wake handed downstream; nothing later in the event log can recover it.
 */
const recordingEngine = () => {
  const wakes: Array<{ readonly threadId: string; readonly instanceIdAtDispatch: string }> = [];
  const layer = Layer.effect(
    OrchestrationEngineService,
    Effect.gen(function* () {
      const real = yield* OrchestrationEngineService;
      const threads = yield* ProjectionThreadRepository;
      const dispatch: OrchestrationEngineShape["dispatch"] = (command, options) =>
        Effect.gen(function* () {
          if (command.type === "thread.turn.start") {
            const row = yield* threads.getById({ threadId: command.threadId }).pipe(Effect.orDie);
            wakes.push({
              threadId: String(command.threadId),
              instanceIdAtDispatch: Option.isSome(row)
                ? String(row.value.modelSelection.instanceId)
                : "ABSENT",
            });
          }
          return yield* real.dispatch(command, options);
        });
      return { ...real, dispatch } satisfies OrchestrationEngineShape;
    }),
  );
  return { wakes, layer };
};

const makeLayer = (
  databasePath: string,
  engine: Layer.Layer<
    OrchestrationEngineService,
    never,
    OrchestrationEngineService | ProjectionThreadRepository
  >,
) =>
  MentionWakeReactorLive.pipe(
    Layer.provide(engine),
    Layer.provideMerge(MentionWakeBudgetRepositoryLive),
    Layer.provideMerge(OrchestrationEngineLive),
    Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
    Layer.provideMerge(OrchestrationProjectionPipelineLive),
    Layer.provideMerge(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provideMerge(OrchestrationEventStoreLive),
    Layer.provideMerge(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provideMerge(makeSqlitePersistenceLive(databasePath)),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-mention-wake-seed-cfg-" }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

const makeSystem = async (databasePath: string) => {
  const recorder = recordingEngine();
  const runtime = ManagedRuntime.make(makeLayer(databasePath, recorder.layer));
  const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
  const reactor = await runtime.runPromise(Effect.service(MentionWakeReactor));
  const cursors = await runtime.runPromise(Effect.service(ProjectionStateRepository));
  const events = await runtime.runPromise(Effect.service(OrchestrationEventStore));
  const scope = await runtime.runPromise(Scope.make());
  return {
    engine,
    reactor,
    cursors,
    events,
    wakes: recorder.wakes,
    run: runtime.runPromise,
    startReactor: () =>
      runtime.runPromise(Scope.provide(reactor.start(), scope) as Effect.Effect<void>),
    drain: () =>
      runtime.runPromise(engine.latestSequence.pipe(Effect.flatMap(reactor.drainThrough))),
    dispose: async () => {
      await runtime.runPromise(Scope.close(scope, Effect.void as never));
      await runtime.dispose();
    },
  };
};

type System = Awaited<ReturnType<typeof makeSystem>>;

/**
 * BOOT ONE, ON THE OLD SEEDER: the seeder's own command ids and the instance it
 * shipped, so the new seeder's creates short-circuit on real receipts and only the
 * repair does anything. Mirrors `OrchestrationEngine.test.ts`'s repair fixture, plus
 * the #project channel the old seeder also created, so the post has somewhere to land.
 */
const oldSeederFixture = async (system: System, workspaceRoot: string) => {
  const dispatch = (command: OrchestrationCommand) =>
    system.run(system.engine.dispatch(command, { issuer: SEED_ISSUER }));
  await dispatch({
    type: "project.create",
    commandId: CommandId.make("seed-project"),
    projectId: SEED_PROJECT_ID,
    title: "t3_bot",
    workspaceRoot,
    createdAt: NOW,
  } as never);
  for (const thread of SEEDED_THREADS) {
    await dispatch({
      type: "thread.create",
      commandId: CommandId.make(`seed-thread-${thread.handle}`),
      threadId: thread.id,
      projectId: SEED_PROJECT_ID,
      title: thread.title,
      modelSelection: { instanceId: ProviderInstanceId.make(SHIPPED_BAD), model: "claude-opus-5" },
      runtimeMode: "auto",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: NOW,
    } as never);
  }
  await dispatch({
    type: "channel.create",
    commandId: CommandId.make("seed-channel-project"),
    channelId: PROJECT_CHANNEL,
    name: "project",
    members: [
      {
        handle: ChannelMemberHandle.make("walt"),
        memberKind: "human",
        memberId: HUMAN_OPERATOR_MEMBER_ID,
      },
      { handle: ChannelMemberHandle.make("pm"), memberKind: "thread", memberId: PM.id },
    ],
    createdAt: NOW,
  } as never);
};

/** The un-consumed post: a human mentions @pm while no reactor is listening. */
const postMentioningPm = (system: System) =>
  system.run(
    system.engine.dispatch(
      {
        type: "channel.post.create",
        commandId: CommandId.make("cmd-post-1"),
        channelId: PROJECT_CHANNEL,
        postId: ChannelPostId.make("post-1"),
        body: "what is 2+2",
        mentions: [ChannelMemberHandle.make("pm")],
        parentPostId: null,
        createdAt: NOW,
      },
      { issuer: WALT },
    ),
  );

const seed = (system: System, workspaceRoot: string) =>
  system.run(HierarchySeeder.seedHierarchy({ workspaceRoot, createdAt: NOW }).pipe(Effect.orDie));

const sequences = async (system: System) => {
  const all = await system.run(
    system.events
      .readFromSequence(0, Number.MAX_SAFE_INTEGER)
      .pipe(Stream.runCollect, Effect.orDie),
  );
  const seqOf = (predicate: (event: (typeof all)[number]) => boolean) => {
    const found = [...all].find(predicate);
    return found?.sequence ?? -1;
  };
  return {
    turnStartRequested: seqOf(
      (e) =>
        e.type === "thread.turn-start-requested" && String(e.payload.threadId) === String(PM.id),
    ),
    metaUpdated: seqOf(
      (e) => e.type === "thread.meta-updated" && String(e.payload.threadId) === String(PM.id),
    ),
    postCreated: seqOf((e) => e.type === "channel.post-created"),
  };
};

const cursor = async (system: System) => {
  const row = await system.run(system.cursors.getByProjector({ projector: MENTION_WAKE_CURSOR }));
  return Option.isSome(row) ? row.value.lastAppliedSequence : -1;
};

/**
 * BOOT ONE writes the cursor (a first start seeds it at the head, so a post older
 * than any cursor is not backlog). THE POST lands with no reactor draining. BOOT TWO
 * replays it, in the order the test chooses.
 */
const primedDatabase = async (databasePath: string, workspaceRoot: string) => {
  const boot1 = await makeSystem(databasePath);
  await oldSeederFixture(boot1, workspaceRoot);
  await boot1.startReactor();
  await boot1.drain();
  const cursorAfterBoot1 = await cursor(boot1);
  await boot1.dispose();
  const down = await makeSystem(databasePath);
  await postMentioningPm(down);
  const postSeq = (await sequences(down)).postCreated;
  await down.dispose();
  expect(postSeq).toBeGreaterThan(cursorAfterBoot1);
  return { cursorAfterBoot1, postSeq };
};

describe("MentionWakeReactor after the hierarchy seed", () => {
  it("a reactor started after the seed wakes a seeded thread against the repaired row", async () => {
    const { directory, databasePath, workspaceRoot } = await makeScratch();
    let system: System | null = null;
    try {
      const primed = await primedDatabase(databasePath, workspaceRoot);
      system = await makeSystem(databasePath);

      // THE INPUT THAT BREAKS THIS: start the reactor before the seed. The backlog replay
      // then wakes @pm against the unrepaired row and `instanceIdAtDispatch` reads
      // `"claude"` — the named mutant, run red once and recorded in the commit.
      await seed(system, workspaceRoot);
      await system.startReactor();
      await system.drain();

      expect(system.wakes).toEqual([{ threadId: String(PM.id), instanceIdAtDispatch: REPAIRED }]);
      const s = await sequences(system);
      expect(s.metaUpdated).toBeGreaterThan(primed.postSeq);
      expect(s.turnStartRequested).toBeGreaterThan(s.metaUpdated);
      expect(await cursor(system)).toBeGreaterThanOrEqual(primed.postSeq);
    } finally {
      await system?.dispose();
      await removeDirectory(directory);
    }
  }, 30_000);
});
