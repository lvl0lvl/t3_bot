/**
 * The comms toolkit against the REAL aggregate, through the REAL gateway.
 *
 * Every other test in this directory fakes the gateway. The seam test runs the
 * toolkit's output through the decider's invariants, which catches disagreement
 * about a RULE. Neither can catch a wiring mistake, and wiring is what this
 * bead is: a gateway that dispatches without an issuer looks correct, compiles,
 * and refuses every post — its own tests would pass, because they never dispatch.
 *
 * So this drives the toolkit's handlers through `ChannelGatewayLive` onto a real
 * engine and a real projection, and asserts what the aggregate STORED.
 *
 * @module commsLive.integration.test
 */
import {
  ChannelId,
  ChannelMemberHandle,
  CommandId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";

import { OrchestrationLayerLive } from "../../../orchestration/runtimeLayer.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { makeSqlitePersistenceLive } from "../../../persistence/Layers/Sqlite.ts";
import { ProjectionChannelRepository } from "../../../persistence/Services/ProjectionChannels.ts";
import * as RepositoryIdentityResolver from "../../../project/RepositoryIdentityResolver.ts";
import { ServerConfig } from "../../../config.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ChannelGateway } from "./channelGateway.ts";
import { ChannelGatewayLive } from "./channelGatewayLive.ts";
import { CommsToolkitHandlersLive } from "./handlers.ts";
import { CommsToolkit } from "./tools.ts";

const PROJECT_ID = ProjectId.make("project-comms-live");
const BOSS3 = ThreadId.make("thread-boss3-live");
const BOSS1 = ThreadId.make("thread-boss1-live");
const CHANNEL_ID = ChannelId.make("channel-seniors-live");
const NOW = "2026-01-01T00:00:00.000Z";
const ADMIN = { memberKind: "human", memberId: "human-walt" } as const;

const TestLayer = CommsToolkitHandlersLive.pipe(
  Layer.provideMerge(ChannelGatewayLive),
  Layer.provideMerge(OrchestrationLayerLive),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provideMerge(makeSqlitePersistenceLive(":memory:")),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-comms-live-" })),
  Layer.provideMerge(NodeServices.layer),
);

const invocation = (threadId: ThreadId): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  threadId,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("claude"),
  capabilities: new Set<McpInvocationContext.McpCapability>(["comms"]),
  issuedAt: 1,
});

/** A project, two agent threads, and a channel both are members of. */
const seed = Effect.fn("seedCommsLive")(function* () {
  const engine = yield* OrchestrationEngineService;
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make("cmd-project-live"),
    projectId: PROJECT_ID,
    title: "Comms",
    workspaceRoot: "/workspace/comms-live",
    createdAt: NOW,
  });
  for (const [threadId, title] of [
    [BOSS3, "Boss3"],
    [BOSS1, "Boss1"],
  ] as const) {
    yield* engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`cmd-thread-${threadId}`),
      projectId: PROJECT_ID,
      threadId,
      title,
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: NOW,
    });
  }
  yield* engine.dispatch(
    {
      type: "channel.create",
      commandId: CommandId.make("cmd-channel-live"),
      channelId: CHANNEL_ID,
      name: "seniors",
      members: [
        { handle: ChannelMemberHandle.make("boss3"), memberKind: "thread", memberId: BOSS3 },
        { handle: ChannelMemberHandle.make("boss1"), memberKind: "thread", memberId: BOSS1 },
      ],
      createdAt: NOW,
    },
    { issuer: ADMIN },
  );
});

const call = Effect.fn("callCommsTool")(function* <Name extends keyof typeof CommsToolkit.tools>(
  name: Name,
  params: unknown,
  threadId: ThreadId,
) {
  const toolkit = yield* CommsToolkit;
  return yield* toolkit.handle(name, params as never).pipe(
    Stream.unwrap,
    Stream.runCollect,
    Effect.map((chunk) => chunk.at(-1)!.result as Tool.Success<(typeof CommsToolkit.tools)[Name]>),
    Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(threadId)),
  );
});

describe("the comms toolkit on the live gateway", () => {
  it.effect(
    "posts as the CREDENTIAL's thread, whatever the arguments say",
    () =>
      Effect.gen(function* () {
        yield* seed();

        // The probe a44 asked for and ax9 kept open: an agent calls with
        // arguments it chose, and what lands carries the author the CREDENTIAL
        // names. There is no argument for an author any more - the command has
        // no such field - so the only way to be wrong here is for the gateway to
        // dispatch without an issuer, which the decider refuses outright.
        const posted = yield* call(
          "comms_post",
          { channel: "#SENIORS", body: "over to you", mentions: ["@Boss1"] },
          BOSS3,
        );
        expect(posted.channel).toBe("seniors");
        expect(posted.mentioned).toEqual(["boss1"]);

        const channels = yield* ProjectionChannelRepository;
        const stored = yield* channels.listPosts({
          channelId: CHANNEL_ID,
          limit: 10,
          afterSequence: undefined,
        });
        expect(stored).toHaveLength(1);
        // The author is the credential's thread, resolved by the DECIDER from
        // the channel's membership - not anything the caller sent.
        expect(stored[0]?.authorHandle).toBe("boss3");
        expect(stored[0]?.mentions).toEqual(["boss1"]);
        expect(stored[0]?.postId).toBe(posted.postId);
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "reads back what the other agent posted, through the same tools",
    () =>
      Effect.gen(function* () {
        yield* seed();
        yield* call("comms_post", { channel: "seniors", body: "from boss1" }, BOSS1);

        // The round trip is the feature: one agent posts, another reads it by
        // name, and the handle it sees is the handle a mention needs.
        const read = yield* call("comms_read_channel", { channel: "seniors" }, BOSS3);
        // BY HANDLE, not by insertion order. The projection returns members
        // sorted, and asserting the order the channel was created in passed
        // nothing and failed here - worth pinning as the order it IS, so the
        // next reader does not build an agent that indexes into this list.
        expect(read.members).toEqual(["boss1", "boss3"]);
        expect(read.posts.map((post) => post.author)).toEqual(["boss1"]);

        // The handle is FOUND rather than indexed, for the same reason.
        const other = read.members.find((handle) => handle !== "boss3");
        expect(other).toBe("boss1");
        const mentioned = yield* call(
          "comms_post",
          { channel: "seniors", body: "seen", mentions: [other!] },
          BOSS3,
        );
        expect(mentioned.mentioned).toEqual(["boss1"]);
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "refuses a post to an archived channel, and still reads it",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const engine = yield* OrchestrationEngineService;
        yield* engine.dispatch(
          {
            type: "channel.archive",
            commandId: CommandId.make("cmd-archive-live"),
            channelId: CHANNEL_ID,
          },
          { issuer: ADMIN },
        );

        // READABLE, NOT POSTABLE - through the live layer rather than a fake
        // that was told to fail. Without the archived read in the gateway the
        // refusal arrives as one invariant error among several and says "could
        // not post" in the decider's words, naming no channel.
        const error = yield* call(
          "comms_post",
          { channel: "seniors", body: "anyone still here" },
          BOSS3,
        ).pipe(Effect.flip);
        expect((error as { _tag: string })._tag).toBe("CommsChannelArchivedError");
        expect((error as { message: string }).message).toContain("seniors");

        const read = yield* call("comms_read_channel", { channel: "seniors" }, BOSS3);
        expect(read.channel).toBe("seniors");
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "treats a non-canonical name as a DEFECT rather than an empty answer",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const gateway = yield* ChannelGateway;

        // Unreachable through the toolkit, which canonicalises first - so this
        // calls the gateway directly, the only way to exercise a guard against
        // a FUTURE caller. Returning None instead would surface as an agent
        // told it is not in a channel it IS in, with nothing saying why.
        const defect = yield* gateway.getChannelForMember("#Seniors", BOSS3).pipe(Effect.exit);
        expect(defect._tag).toBe("Failure");
        expect(String(defect)).toContain("non-canonical name");

        // The canonical form of the same name resolves, so the assertion above
        // is about the FORM rather than about the channel being absent.
        const found = yield* gateway.getChannelForMember("seniors", BOSS3);
        expect(Option.isSome(found)).toBe(true);
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );

  it.effect(
    "hides a channel the calling thread is not a member of",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const engine = yield* OrchestrationEngineService;
        yield* engine.dispatch(
          {
            type: "channel.member.remove",
            commandId: CommandId.make("cmd-remove-boss3"),
            channelId: CHANNEL_ID,
            handle: ChannelMemberHandle.make("boss3"),
          },
          { issuer: ADMIN },
        );

        const error = yield* call("comms_read_channel", { channel: "seniors" }, BOSS3).pipe(
          Effect.flip,
        );
        // The same answer a non-existent channel gives, byte for byte: an agent
        // must not be able to probe for channels it is not in.
        expect((error as { _tag: string })._tag).toBe("CommsChannelNotFoundError");
        expect((error as { message: string }).message).toBe(
          "No channel named 'seniors' that you are a member of.",
        );

        // And the channel is still there for the member who remains, so the
        // assertion above is about MEMBERSHIP rather than about the channel
        // having gone.
        const stillThere = yield* call("comms_read_channel", { channel: "seniors" }, BOSS1);
        expect(stillThere.members).toEqual(["boss1"]);
      }).pipe(Effect.provide(TestLayer)),
    30_000,
  );
});
