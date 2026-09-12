import {
  ChannelId,
  ChannelMemberHandle,
  ChannelPostId,
  CommandId,
  EnvironmentId,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  ThreadId,
  type ClientOrchestrationCommand,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as RpcSession from "../rpc/session.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import {
  archiveThread,
  createChannelPost,
  createProject,
  reorderActiveThread,
  settleThread,
  stopThreadSession,
  unsettleThread,
} from "./commands.ts";

const TEST_CRYPTO_LAYER = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => new Uint8Array(size),
    digest: (_algorithm, data) => Effect.succeed(data),
  }),
);

/**
 * A crypto layer whose bytes differ per call.
 *
 * `TEST_CRYPTO_LAYER` above returns all zeros, so every UUID it generates is
 * `00000000-0000-4000-8000-000000000000` — which means two mints already
 * collide under it, and an assertion that two generated ids DIFFER cannot
 * distinguish a correct implementation from one that mints once and reuses.
 *
 * This one fills each request with an incrementing byte, so the ids differ iff
 * the code actually generated twice. That is the difference the post-id test
 * rests on.
 */
const countingCryptoLayer = () => {
  let call = 0;
  return Layer.succeed(
    Crypto.Crypto,
    Crypto.make({
      randomBytes: (size) => {
        call += 1;
        return new Uint8Array(size).fill(call);
      },
      digest: (_algorithm, data) => Effect.succeed(data),
    }),
  );
};

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

const makeSupervisor = Effect.fn("TestEnvironmentCommands.makeSupervisor")(function* (
  dispatched: ClientOrchestrationCommand[],
) {
  const client = {
    [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command: ClientOrchestrationCommand) =>
      Effect.sync(() => {
        dispatched.push(command);
        return { sequence: dispatched.length };
      }),
  } as unknown as WsRpcProtocolClient;
  const session: RpcSession.RpcSession = {
    client,
    initialConfig: Effect.never,
    subscribeServerConfig: (input) => client.subscribeServerConfig(input),
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
  return EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: TARGET,
    state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
    session: yield* SubscriptionRef.make(Option.some(session)),
    prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
});

describe("environment commands", () => {
  it.effect("adds generated command metadata", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      const result = yield* createProject({
        projectId: ProjectId.make("project-1"),
        title: "Project",
        workspaceRoot: "/workspace/project",
        createdAt: "2026-06-06T00:00:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(result).toEqual({ sequence: 1 });
      expect(dispatched).toEqual([
        {
          type: "project.create",
          commandId: "00000000-0000-4000-8000-000000000000",
          projectId: "project-1",
          title: "Project",
          workspaceRoot: "/workspace/project",
          createdAt: "2026-06-06T00:00:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("preserves caller metadata for idempotent queued commands", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* stopThreadSession({
        commandId: CommandId.make("queued-command"),
        threadId: ThreadId.make("thread-1"),
        createdAt: "2026-06-06T00:01:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.session.stop",
          commandId: "queued-command",
          threadId: "thread-1",
          createdAt: "2026-06-06T00:01:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("does not add timestamps to commands without createdAt", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* archiveThread({
        commandId: CommandId.make("archive-command"),
        threadId: ThreadId.make("thread-1"),
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.archive",
          commandId: "archive-command",
          threadId: "thread-1",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("dispatches settle and unsettle commands without timestamps", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* settleThread({
        commandId: CommandId.make("settle-command"),
        threadId: ThreadId.make("thread-1"),
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));
      yield* unsettleThread({
        commandId: CommandId.make("unsettle-command"),
        threadId: ThreadId.make("thread-1"),
        reason: "user",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.settle",
          commandId: "settle-command",
          threadId: "thread-1",
        },
        {
          type: "thread.unsettle",
          commandId: "unsettle-command",
          threadId: "thread-1",
          reason: "user",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("sends an active order key without changing activity timestamps", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);
      yield* reorderActiveThread({
        commandId: CommandId.make("reorder-command"),
        threadId: ThreadId.make("thread-1"),
        orderKey: "mf",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));
      expect(dispatched).toEqual([
        {
          type: "thread.active.reorder",
          commandId: "reorder-command",
          threadId: "thread-1",
          orderKey: "mf",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );
  it.effect("mints a fresh post id for every send", () =>
    Effect.gen(function* () {
      // THE ONE THAT WAS MISSING, and the aggregate is why it matters: it does
      // not refuse a post id it has already seen, so two commands carrying one
      // id BOTH commit while the projection's ON CONFLICT DO NOTHING keeps the
      // first. The second post then wakes an agent with nothing readable behind
      // it. Hoisting this id out of the effect passed the whole suite.
      //
      // Under the all-zeros crypto stub both mints would be identical and this
      // assertion would be meaningless, so it runs on the counting stub.
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);
      const send = () =>
        createChannelPost({
          channelId: ChannelId.make("channel-seniors"),
          body: "what is 2+2",
          mentions: [],
          parentPostId: null,
        }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      yield* send();
      yield* send();

      const postIds = dispatched.map((command) =>
        command.type === "channel.post.create" ? command.postId : null,
      );
      expect(postIds).toHaveLength(2);
      expect(postIds[0]).not.toBe(postIds[1]);
      // And the COMMAND ids differ too, which is the separate half: receipt
      // idempotence is keyed on the command id, so two sends that shared one
      // would make the second a no-op instead of a second post.
      expect(dispatched[0]?.commandId).not.toBe(dispatched[1]?.commandId);
    }).pipe(Effect.provide(countingCryptoLayer())),
  );

  it.effect("keeps a caller-supplied post id, so one command stays retryable", () =>
    Effect.gen(function* () {
      // The other direction. Re-sending ONE command must stay a no-op rather
      // than a second post, so a caller that supplies both ids must get both
      // through untouched — otherwise a retry would mint a new post id and the
      // retry would post twice.
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* createChannelPost({
        commandId: CommandId.make("post-command"),
        postId: ChannelPostId.make("post-1"),
        channelId: ChannelId.make("channel-seniors"),
        body: "retried",
        mentions: [ChannelMemberHandle.make("boss1")],
        parentPostId: null,
        createdAt: "2026-06-06T00:00:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "channel.post.create",
          commandId: "post-command",
          postId: "post-1",
          channelId: "channel-seniors",
          body: "retried",
          mentions: ["boss1"],
          parentPostId: null,
          createdAt: "2026-06-06T00:00:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(countingCryptoLayer())),
  );
});
