import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ChannelGateway from "./channelGateway.ts";
import { CommsToolkitHandlersLive, normalizeChannelName, resolveMentions } from "./handlers.ts";
import { CommsToolkit } from "./tools.ts";

const THREAD_ID = ThreadId.make("thread-boss3");
const OTHER_THREAD_ID = ThreadId.make("thread-boss1");
const CHANNEL_ID = "channel-seniors";

const MEMBERS: ReadonlyArray<ChannelGateway.ChannelMember> = [
  { handle: "pm", memberKind: "thread", memberId: "thread-pm" },
  { handle: "boss1", memberKind: "thread", memberId: OTHER_THREAD_ID },
  { handle: "boss3", memberKind: "thread", memberId: THREAD_ID },
  { handle: "walt", memberKind: "human", memberId: "human-walt" },
];

const invocation = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability>,
  threadId: ThreadId = THREAD_ID,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  threadId,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("claude"),
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

const post = (
  postId: string,
  overrides: Partial<ChannelGateway.ChannelPostRecord> = {},
): ChannelGateway.ChannelPostRecord => ({
  postId,
  authorHandle: "pm",
  body: `body of ${postId}`,
  mentions: [],
  parentPostId: null,
  createdAt: "2026-09-11T18:00:00.000Z",
  ...overrides,
});

interface HarnessOptions {
  /** Channels by canonical name, each listing the threads that may see it. */
  readonly channels?: ReadonlyArray<{
    readonly name: string;
    readonly memberThreadIds: ReadonlyArray<string>;
  }>;
  readonly posts?: ReadonlyArray<ChannelGateway.ChannelPostRecord>;
}

const makeHarness = Effect.fn("makeCommsToolkitHarness")(function* (options: HarnessOptions = {}) {
  const channels = options.channels ?? [
    { name: "seniors", memberThreadIds: [THREAD_ID, OTHER_THREAD_ID, "thread-pm"] },
  ];
  const created = yield* Ref.make<ReadonlyArray<ChannelGateway.CreatePostInput>>([]);
  const reads = yield* Ref.make<ReadonlyArray<ChannelGateway.ReadPostsInput>>([]);

  const gateway = Layer.succeed(
    ChannelGateway.ChannelGateway,
    ChannelGateway.ChannelGateway.of({
      getChannelForMember: (name, threadId) =>
        Effect.succeed(
          Option.fromNullishOr(
            channels.find(
              (channel) => channel.name === name && channel.memberThreadIds.includes(threadId),
            ),
          ).pipe(
            Option.map((channel): ChannelGateway.Channel => ({
              channelId: CHANNEL_ID,
              name: channel.name,
              members: MEMBERS,
            })),
          ),
        ),
      createPost: (input) =>
        Ref.update(created, (recorded) => [...recorded, input]).pipe(
          Effect.as({ postId: "post-new", createdAt: "2026-09-11T18:05:00.000Z" }),
        ),
      readPosts: (input) =>
        Ref.update(reads, (recorded) => [...recorded, input]).pipe(
          Effect.as({ posts: options.posts ?? [], nextCursor: null }),
        ),
    }),
  );

  const toolkit = yield* CommsToolkit.pipe(
    Effect.provide(CommsToolkitHandlersLive.pipe(Layer.provide(gateway))),
  );

  const call = <Name extends keyof typeof CommsToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
    capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["comms"],
    threadId: ThreadId = THREAD_ID,
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map(
        (chunk) => chunk.at(-1)!.result as Tool.Success<(typeof CommsToolkit.tools)[Name]>,
      ),
      Effect.provideService(
        McpInvocationContext.McpInvocationContext,
        invocation(capabilities, threadId),
      ),
      Effect.provide(gateway),
    );

  return { call, created, reads };
});

describe("comms toolkit handlers", () => {
  it.effect("refuses a credential without the comms capability", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness
        .call("post", { channel: "#seniors", body: "hello" }, ["pull-requests"])
        .pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "McpCapabilityUnavailableError",
        capability: "comms",
        threadId: THREAD_ID,
      });
      // The refusal must happen before the write, not after it.
      expect(yield* Ref.get(harness.created)).toEqual([]);
    }),
  );

  it.effect("posts as the calling thread, never as an argument-supplied author", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("post", { channel: "#seniors", body: "status update" });
      expect(result).toEqual({
        postId: "post-new",
        channel: "seniors",
        createdAt: "2026-09-11T18:05:00.000Z",
        mentioned: [],
      });
      expect(yield* Ref.get(harness.created)).toEqual([
        {
          channelId: CHANNEL_ID,
          authorThreadId: THREAD_ID,
          body: "status update",
          mentions: [],
          parentPostId: null,
        },
      ]);
    }),
  );

  it.effect("derives the author from the credential, so two threads cannot share one", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.call("post", { channel: "seniors", body: "from boss3" });
      yield* harness.call(
        "post",
        { channel: "seniors", body: "from boss1" },
        ["comms"],
        OTHER_THREAD_ID,
      );
      expect((yield* Ref.get(harness.created)).map((input) => input.authorThreadId)).toEqual([
        THREAD_ID,
        OTHER_THREAD_ID,
      ]);
    }),
  );

  it.effect("hides a channel the calling thread is not a member of", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        channels: [{ name: "private", memberThreadIds: [OTHER_THREAD_ID] }],
      });
      const error = yield* harness
        .call("post", { channel: "#private", body: "let me in" })
        .pipe(Effect.flip);
      // Same error a missing channel gives: non-membership must not be probeable.
      expect(error).toMatchObject({ _tag: "CommsChannelNotFoundError", channel: "private" });
      expect(yield* Ref.get(harness.created)).toEqual([]);
    }),
  );

  it.effect("resolves mentions and strips the leading @", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("post", {
        channel: "seniors",
        body: "over to you",
        mentions: ["@boss1", "walt"],
      });
      expect(result.mentioned).toEqual(["boss1", "walt"]);
      expect((yield* Ref.get(harness.created))[0]?.mentions).toEqual(["boss1", "walt"]);
    }),
  );

  it.effect("rejects the whole post when a mention does not resolve", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness
        .call("post", {
          channel: "seniors",
          body: "ping",
          mentions: ["boss1", "@nobody", "alsomissing"],
        })
        .pipe(Effect.flip);
      // Every bad handle at once, so a retry does not find them one at a time.
      expect(error).toMatchObject({
        _tag: "CommsMemberNotFoundError",
        handles: ["nobody", "alsomissing"],
      });
      // A post whose mention silently vanished would wake nobody while looking sent.
      expect(yield* Ref.get(harness.created)).toEqual([]);
    }),
  );

  it.effect("threads a reply onto an existing post", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ posts: [post("post-1"), post("post-2")] });
      const result = yield* harness.call("reply", {
        channel: "seniors",
        parentPostId: "post-2",
        body: "acknowledged",
      });
      expect(result.postId).toEqual("post-new");
      expect(yield* Ref.get(harness.created)).toEqual([
        {
          channelId: CHANNEL_ID,
          authorThreadId: THREAD_ID,
          body: "acknowledged",
          mentions: [],
          parentPostId: "post-2",
        },
      ]);
    }),
  );

  it.effect("refuses a reply to a post that is not in the channel", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ posts: [post("post-1")] });
      const error = yield* harness
        .call("reply", { channel: "seniors", parentPostId: "post-999", body: "..." })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "CommsPostNotFoundError", postId: "post-999" });
      // Otherwise the agent believes it replied and the message lands unthreaded.
      expect(yield* Ref.get(harness.created)).toEqual([]);
    }),
  );

  it.effect("reads posts with the member list the agent needs to mention anyone", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        posts: [post("post-1", { mentions: ["boss3"], authorHandle: "pm" })],
      });
      const result = yield* harness.call("read_channel", { channel: "#seniors" });
      expect(result).toEqual({
        channel: "seniors",
        members: ["pm", "boss1", "boss3", "walt"],
        posts: [
          {
            postId: "post-1",
            author: "pm",
            body: "body of post-1",
            mentions: ["boss3"],
            parentPostId: null,
            createdAt: "2026-09-11T18:00:00.000Z",
          },
        ],
        nextCursor: null,
      });
    }),
  );

  it.effect("caps an oversized read limit instead of passing it through", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.call("read_channel", { channel: "seniors", limit: 5000 });
      expect((yield* Ref.get(harness.reads))[0]?.limit).toEqual(200);
    }),
  );

  it.effect("defaults the read limit when the agent omits it", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.call("read_channel", { channel: "seniors" });
      expect((yield* Ref.get(harness.reads))[0]?.limit).toEqual(50);
    }),
  );
});

describe("comms toolkit helpers", () => {
  it("normalizes channel names written with or without #", () => {
    expect(normalizeChannelName("#seniors")).toEqual("seniors");
    expect(normalizeChannelName("  seniors  ")).toEqual("seniors");
    expect(normalizeChannelName("##seniors")).toEqual("seniors");
  });

  it("collapses duplicate mentions to the member's canonical handle", () => {
    expect(resolveMentions(["@boss1", "boss1", "  @boss1  "], MEMBERS)).toEqual({
      handles: ["boss1"],
    });
  });

  it("reports unknown handles once each, in the order they appeared", () => {
    expect(resolveMentions(["@ghost", "boss1", "ghost", "@other"], MEMBERS)).toEqual({
      unknown: ["ghost", "other"],
    });
  });

  it("ignores an empty mention rather than failing the post", () => {
    expect(resolveMentions(["@", "  ", "boss1"], MEMBERS)).toEqual({ handles: ["boss1"] });
  });
});
