/**
 * The reactor's whole job is to lose nothing, so every test here is about a
 * post it could have missed rather than one it obviously sees.
 *
 * The engine publishes to its PubSub AFTER the transaction commits, so an event
 * can be durable and never published — which is why "subscribe and take what
 * arrives" is not enough and why these tests restart the system rather than
 * asserting against one live run.
 */

import {
  ChannelId,
  ChannelMemberHandle,
  ChannelPostId,
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import { describe, expect, it } from "vite-plus/test";

import { makeSqlitePersistenceLive } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { ProjectionStateRepository } from "../../persistence/Services/ProjectionState.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { ServerConfig } from "../../config.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { MentionWakeReactor, MENTION_WAKE_CURSOR } from "../Services/MentionWakeReactor.ts";
import { MentionWakeReactorLive } from "./MentionWakeReactor.ts";

const scratchRuntime = ManagedRuntime.make(NodeServices.layer);

const makeDatabasePath = () =>
  scratchRuntime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectory({ prefix: "t3-mention-wake-" });
      return { directory, databasePath: path.join(directory, "state.sqlite") };
    }),
  );

const removeDirectory = (directory: string) =>
  scratchRuntime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.remove(directory, { recursive: true });
    }).pipe(Effect.ignore),
  );

const PROJECT_ID = ProjectId.make("project-comms");
const WOKEN = ThreadId.make("thread-woken");
const CHANNEL_ID = ChannelId.make("channel-seniors");
const NOW = "2026-01-01T00:00:00.000Z";

const makeLayer = (databasePath: string) =>
  MentionWakeReactorLive.pipe(
    Layer.provideMerge(OrchestrationEngineLive),
    Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
    Layer.provideMerge(OrchestrationProjectionPipelineLive),
    Layer.provideMerge(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provideMerge(OrchestrationEventStoreLive),
    Layer.provideMerge(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provideMerge(makeSqlitePersistenceLive(databasePath)),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-mention-wake-test-" })),
    Layer.provideMerge(NodeServices.layer),
  );

/**
 * A system that can be stopped and started again against the same database,
 * because every criterion here is about what survives a restart.
 */
const makeSystem = async (databasePath: string) => {
  const runtime = ManagedRuntime.make(makeLayer(databasePath));
  const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
  const reactor = await runtime.runPromise(Effect.service(MentionWakeReactor));
  const cursors = await runtime.runPromise(Effect.service(ProjectionStateRepository));
  const threads = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));
  const scope = await runtime.runPromise(Scope.make());
  return {
    engine,
    reactor,
    cursors,
    threads,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    startReactor: () =>
      runtime.runPromise(Scope.provide(reactor.start(), scope) as Effect.Effect<void>),
    dispose: async () => {
      await runtime.runPromise(Scope.close(scope, Effect.void as never));
      await runtime.dispose();
    },
  };
};

type System = Awaited<ReturnType<typeof makeSystem>>;

/** A project, a thread to wake, and a channel that thread is a member of. */
const seedChannel = async (system: System) => {
  await system.run(
    system.engine.dispatch({
      type: "project.create",
      commandId: CommandId.make("cmd-project"),
      projectId: PROJECT_ID,
      title: "Comms",
      workspaceRoot: "/workspace/comms",
      createdAt: NOW,
    }),
  );
  await system.run(
    system.engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make("cmd-thread"),
      projectId: PROJECT_ID,
      threadId: WOKEN,
      title: "Woken",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: NOW,
    }),
  );
  await system.run(
    system.engine.dispatch({
      type: "channel.create",
      commandId: CommandId.make("cmd-channel"),
      channelId: CHANNEL_ID,
      name: "seniors",
      members: [
        { handle: ChannelMemberHandle.make("woken"), memberKind: "thread", memberId: WOKEN },
        // The author has to be a member too - the decider refuses a post from a
        // non-member, which is the control that keeps an outsider from learning
        // a channel exists.
        { handle: ChannelMemberHandle.make("walt"), memberKind: "human", memberId: "human-walt" },
      ],
      createdAt: NOW,
    }),
  );
};

const post = async (
  system: System,
  input: { readonly id: string; readonly mentions: ReadonlyArray<ChannelMemberHandle> },
) =>
  system.run(
    system.engine.dispatch({
      type: "channel.post.create",
      commandId: CommandId.make(`cmd-post-${input.id}`),
      channelId: CHANNEL_ID,
      postId: ChannelPostId.make(input.id),
      authorRef: { memberKind: "human", memberId: "human-walt" },
      body: "have a look at this",
      mentions: input.mentions,
      parentPostId: null,
      createdAt: NOW,
    }),
  );

/**
 * What the woken thread actually received, read through the same projection the
 * UI reads. "Was it woken" is a question about the thread's messages, not about
 * whether a command was dispatched.
 */
const wakeMessages = async (system: System) => {
  const detail = await system.run(system.threads.getThreadDetailById(WOKEN));
  return Option.isNone(detail)
    ? []
    : detail.value.messages
        .map((message) => message.text ?? "")
        .filter((text) => text.startsWith("[comms]"));
};

describe("MentionWakeReactor", () => {
  it("wakes a thread for a post that landed while it was not running", async () => {
    const { directory, databasePath } = await makeDatabasePath();
    let system = await makeSystem(databasePath);
    try {
      await seedChannel(system);
      // The reactor has never run, so it must not owe anything for history: it
      // starts at the head. This post is BEFORE that first start.
      await system.startReactor();
      await system.dispose();

      system = await makeSystem(databasePath);
      await post(system, { id: "post-1", mentions: [ChannelMemberHandle.make("woken")] });
      await system.dispose();

      system = await makeSystem(databasePath);
      await system.startReactor();
      // Waited on rather than slept through: the reactor's own fence says when
      // every event up to the head has been handed to the worker and the worker
      // is idle. A timeout here would be a test that passes for a reason it
      // cannot state.
      await system.run(
        system.engine.latestSequence.pipe(Effect.flatMap(system.reactor.drainThrough)),
      );

      // The assertion the whole reactor exists for: a post that landed while
      // nothing was listening still woke the thread it mentioned.
      const messages = await wakeMessages(system);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("[comms] #seniors · @walt mentioned you · post post-1");
      expect(messages[0]).toContain("have a look at this");
      expect(messages[0]).toContain("Do not answer here");

      // Restarting with nothing new must not wake the thread a second time.
      //
      // Read what this actually proves, because it is NOT that the cursor
      // advanced: deleting the cursor write entirely leaves this green. The
      // deterministic commandId means a replayed dispatch is absorbed by the
      // engine's receipt check, so the EFFECT is exactly-once however many
      // times the post is replayed. That is the guarantee worth having and it
      // is what this asserts.
      //
      // The cursor is asserted separately below, because a cursor that never
      // advances replays the entire event log on every boot - invisible here,
      // and a real defect.
      await system.dispose();
      system = await makeSystem(databasePath);
      await system.startReactor();
      await system.run(
        system.engine.latestSequence.pipe(Effect.flatMap(system.reactor.drainThrough)),
      );
      expect(await wakeMessages(system)).toHaveLength(1);

      const head = await system.run(system.engine.latestSequence);
      const cursor = await system.run(
        system.cursors.getByProjector({ projector: MENTION_WAKE_CURSOR }),
      );
      expect(Option.isSome(cursor) ? cursor.value.lastAppliedSequence : -1).toEqual(head);
    } finally {
      await system.dispose();
      await removeDirectory(directory);
    }
  }, 30_000);

  it("wakes nobody for a post that mentions nobody", async () => {
    const { directory, databasePath } = await makeDatabasePath();
    let system = await makeSystem(databasePath);
    try {
      await seedChannel(system);
      await system.startReactor();
      await post(system, { id: "post-quiet", mentions: [] });
      await system.run(
        system.engine.latestSequence.pipe(Effect.flatMap(system.reactor.drainThrough)),
      );
      expect(await wakeMessages(system)).toHaveLength(0);
    } finally {
      await system.dispose();
      await removeDirectory(directory);
    }
  }, 30_000);
});
