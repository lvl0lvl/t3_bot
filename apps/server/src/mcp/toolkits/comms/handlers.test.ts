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

/** Failures the fake gateway can be told to raise, by operation. */
interface GatewayFailures {
  readonly getChannel?: ChannelGateway.ChannelStoreUnavailable;
  readonly getPost?: ChannelGateway.ChannelStoreUnavailable;
  readonly readPosts?: ChannelGateway.ChannelStoreUnavailable;
  readonly createPost?:
    | ChannelGateway.ChannelStoreUnavailable
    | ChannelGateway.ChannelWriteConflict
    | ChannelGateway.ChannelMembershipRevoked
    | ChannelGateway.ChannelMentionUnresolvable;
  /** Raised as a DEFECT rather than a typed failure. */
  readonly dieOn?: "getChannel" | "createPost" | "readPosts" | "getPost";
}

interface HarnessOptions {
  readonly channels?: ReadonlyArray<{
    readonly name: string;
    readonly memberThreadIds: ReadonlyArray<string>;
  }>;
  readonly posts?: ReadonlyArray<ChannelGateway.ChannelPostRecord>;
  readonly failures?: GatewayFailures;
}

const makeHarness = Effect.fn("makeCommsToolkitHarness")(function* (options: HarnessOptions = {}) {
  const channels = options.channels ?? [
    { name: "seniors", memberThreadIds: [THREAD_ID, OTHER_THREAD_ID, "thread-pm"] },
  ];
  const allPosts = options.posts ?? [];
  const fail = options.failures ?? {};
  const created = yield* Ref.make<ReadonlyArray<ChannelGateway.CreatePostInput>>([]);
  const reads = yield* Ref.make<ReadonlyArray<ChannelGateway.ReadPostsInput>>([]);
  const postLookups = yield* Ref.make<ReadonlyArray<readonly [string, string]>>([]);
  const channelLookups = yield* Ref.make<ReadonlyArray<readonly [string, string]>>([]);

  const die = (op: GatewayFailures["dieOn"]) =>
    fail.dieOn === op ? Effect.die(new Error(`fake gateway defect in ${op}`)) : Effect.void;

  const gateway = Layer.succeed(
    ChannelGateway.ChannelGateway,
    ChannelGateway.ChannelGateway.of({
      getChannelForMember: (name, threadId) =>
        die("getChannel").pipe(
          Effect.andThen(fail.getChannel ? Effect.fail(fail.getChannel) : Effect.void),
          Effect.andThen(
            Ref.update(channelLookups, (seen) => [...seen, [name, threadId] as const]),
          ),
          Effect.as(
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
        ),

      getPost: (channelId, postId) =>
        die("getPost").pipe(
          Effect.andThen(fail.getPost ? Effect.fail(fail.getPost) : Effect.void),
          Effect.andThen(
            Ref.update(postLookups, (seen) => [...seen, [channelId, postId] as const]),
          ),
          Effect.as(
            Option.fromNullishOr(
              channelId === CHANNEL_ID
                ? allPosts.find((entry) => entry.postId === postId)
                : undefined,
            ),
          ),
        ),

      // Pages honestly: `cursor` points AFTER the last post returned, `limit`
      // is respected, `nextCursor` is null only when no newer posts remain.
      // A fake that ignores limit and cursor cannot see a paging bug at all.
      readPosts: (input) =>
        die("readPosts").pipe(
          Effect.andThen(fail.readPosts ? Effect.fail(fail.readPosts) : Effect.void),
          Effect.andThen(Ref.update(reads, (seen) => [...seen, input])),
          Effect.map(() => {
            const startIndex =
              input.cursor === undefined
                ? 0
                : allPosts.findIndex((entry) => entry.postId === input.cursor) + 1;
            const page = allPosts.slice(startIndex, startIndex + input.limit);
            const consumed = startIndex + page.length;
            return {
              posts: page,
              nextCursor: consumed < allPosts.length ? (page.at(-1)?.postId ?? null) : null,
            } satisfies ChannelGateway.ChannelPage;
          }),
        ),

      createPost: (input) =>
        die("createPost").pipe(
          Effect.andThen(fail.createPost ? Effect.fail(fail.createPost) : Effect.void),
          Effect.andThen(Ref.update(created, (recorded) => [...recorded, input])),
          Effect.as({ postId: "post-new", createdAt: "2026-09-11T18:05:00.000Z" }),
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

  return { call, created, reads, postLookups, channelLookups };
});

describe("comms toolkit handlers", () => {
  it.effect("refuses a credential without the comms capability", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness
        .call("comms_post", { channel: "#seniors", body: "hello" }, ["pull-requests"])
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
      const result = yield* harness.call("comms_post", {
        channel: "#seniors",
        body: "status update",
      });
      expect(result).toEqual({
        postId: "post-new",
        channel: "seniors",
        createdAt: "2026-09-11T18:05:00.000Z",
        mentioned: [],
      });
      expect(yield* Ref.get(harness.created)).toEqual([
        {
          channelId: CHANNEL_ID,
          authorRef: { memberKind: "thread", memberId: THREAD_ID },
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
      yield* harness.call("comms_post", { channel: "seniors", body: "from boss3" });
      yield* harness.call(
        "comms_post",
        { channel: "seniors", body: "from boss1" },
        ["comms"],
        OTHER_THREAD_ID,
      );
      expect((yield* Ref.get(harness.created)).map((input) => input.authorRef.memberId)).toEqual([
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
        .call("comms_post", { channel: "#private", body: "let me in" })
        .pipe(Effect.flip);
      // Same error a missing channel gives: non-membership must not be probeable.
      expect(error).toMatchObject({ _tag: "CommsChannelNotFoundError", channel: "private" });
      expect(yield* Ref.get(harness.created)).toEqual([]);
    }),
  );

  it.effect("rejects a channel name that is only sigils and whitespace", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      for (const channel of ["#", "##", "#   "]) {
        const error = yield* harness.call("comms_post", { channel, body: "x" }).pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "CommsChannelNotFoundError", channel: "" });
      }
      // An empty name must never reach the gateway as a lookup.
      expect(yield* Ref.get(harness.created)).toEqual([]);
    }),
  );

  it.effect("accepts a channel written with a space after the sigil", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("comms_post", { channel: "# seniors", body: "hi" });
      expect(result.channel).toEqual("seniors");
    }),
  );

  /**
   * The canonical rule, as a table, because the toolkit and the decider each
   * implement it and they have already disagreed once: the toolkit stripped
   * every leading sigil while the decider stripped one, so "##seniors" resolved
   * to two different channels depending on which side you asked. When the rule
   * moves, this is the one place to change it — and the decider has the
   * matching table, so a silent divergence has to break both.
   */
  it("canonicalizes a channel name the way the aggregate stores it", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["seniors", "seniors"],
      ["#seniors", "seniors"],
      ["Seniors", "seniors"],
      ["#SENIORS", "seniors"],
      ["  ##SENIORS  ", "seniors"],
      ["# seniors", "seniors"],
      // Only sigils and spaces: empty, and rejected before any lookup.
      ["#", ""],
      ["##", ""],
      ["#   ", ""],
      // A sigil that is not leading is part of the name.
      ["a#b", "a#b"],
    ];
    expect(cases.map(([input]) => [input, normalizeChannelName(input)])).toEqual(
      cases.map(([input, expected]) => [input, expected]),
    );
  });

  it.effect("finds a channel whatever case the agent types", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("comms_post", {
        channel: "  ##SENIORS  ",
        body: "case should not matter",
      });
      expect(result.channel).toEqual("seniors");
      // The canonical form is what reaches the seam. Matching there is exact,
      // so anything else reads as "no such channel" — which is deliberately the
      // same answer a non-member gets, and therefore undiagnosable.
      expect(yield* Ref.get(harness.channelLookups)).toEqual([["seniors", THREAD_ID]]);
    }),
  );

  it.effect("resolves a mention whatever case the agent types", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("comms_post", {
        channel: "seniors",
        body: "over to you",
        mentions: ["@BOSS1", "Walt"],
      });
      // Echoed and stored canonically: the aggregate matches a mention against
      // its member handles exactly, so a mention written back in the agent's
      // casing would wake nobody while looking delivered.
      expect(result.mentioned).toEqual(["boss1", "walt"]);
      expect((yield* Ref.get(harness.created))[0]?.mentions).toEqual(["boss1", "walt"]);
    }),
  );

  it.effect("resolves mentions written with a sigil, a space, or both", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("comms_post", {
        channel: "seniors",
        body: "over to you",
        mentions: ["@boss1", "walt", "@ pm"],
      });
      expect(result.mentioned).toEqual(["boss1", "walt", "pm"]);
      expect((yield* Ref.get(harness.created))[0]?.mentions).toEqual(["boss1", "walt", "pm"]);
    }),
  );

  it.effect("rejects a body that is empty once whitespace is removed", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      for (const body of ["   ", "\n", " \t \n "]) {
        const error = yield* harness
          .call("comms_post", { channel: "seniors", body })
          .pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "CommsEmptyBodyError" });
      }
      // An empty post must never reach the channel.
      expect(yield* Ref.get(harness.created)).toEqual([]);
    }),
  );

  it.effect("stores the trimmed body", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.call("comms_post", { channel: "seniors", body: "  hello  " });
      expect((yield* Ref.get(harness.created))[0]?.body).toEqual("hello");
    }),
  );

  it.effect("reports member handles in the same form a mention resolves against", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("comms_read_channel", { channel: "seniors" });
      // The exact list, not a property of it: "no leading @" also passes for a
      // handle mangled some other way, and these strings are what the agent
      // must send back verbatim as a mention.
      expect(result.members).toEqual(["pm", "boss1", "boss3", "walt"]);
    }),
  );

  it.effect("rejects the whole post when a mention does not resolve", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness
        .call("comms_post", {
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

  it.effect("replies to a post far outside the first page", () =>
    Effect.gen(function* () {
      const many = Array.from({ length: 250 }, (_, index) => post(`post-${index + 1}`));
      const harness = yield* makeHarness({ posts: many });
      const result = yield* harness.call("comms_reply", {
        channel: "seniors",
        parentPostId: "post-250",
        body: "acknowledged",
      });
      expect(result.postId).toEqual("post-new");
      expect((yield* Ref.get(harness.created))[0]?.parentPostId).toEqual("post-250");
      // Answered by a direct lookup, never by paging history.
      expect(yield* Ref.get(harness.postLookups)).toEqual([[CHANNEL_ID, "post-250"]]);
      expect(yield* Ref.get(harness.reads)).toEqual([]);
    }),
  );

  it.effect("resolves the channel exactly once per reply", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ posts: [post("post-1")] });
      yield* harness.call("comms_reply", {
        channel: "seniors",
        parentPostId: "post-1",
        body: "ack",
      });
      // The membership lookup itself, not a proxy for it: counting getPost
      // calls leaves a second resolution completely undetected, and validating
      // the parent against a different resolution than the post is written to
      // would let the two disagree.
      expect(yield* Ref.get(harness.channelLookups)).toEqual([["seniors", THREAD_ID]]);
      expect(yield* Ref.get(harness.postLookups)).toEqual([[CHANNEL_ID, "post-1"]]);
    }),
  );

  it.effect("refuses a reply to a post that is not in the channel", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ posts: [post("post-1")] });
      const error = yield* harness
        .call("comms_reply", { channel: "seniors", parentPostId: "post-999", body: "..." })
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
      const result = yield* harness.call("comms_read_channel", { channel: "#seniors" });
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

  it.effect("pages forward through the channel and stops at the newest post", () =>
    Effect.gen(function* () {
      const many = Array.from({ length: 5 }, (_, index) => post(`post-${index + 1}`));
      const harness = yield* makeHarness({ posts: many });

      const first = yield* harness.call("comms_read_channel", { channel: "seniors", limit: 2 });
      expect(first.posts.map((entry) => entry.postId)).toEqual(["post-1", "post-2"]);
      expect(first.nextCursor).toEqual("post-2");

      const second = yield* harness.call("comms_read_channel", {
        channel: "seniors",
        limit: 2,
        cursor: first.nextCursor!,
      });
      expect(second.posts.map((entry) => entry.postId)).toEqual(["post-3", "post-4"]);

      const third = yield* harness.call("comms_read_channel", {
        channel: "seniors",
        limit: 2,
        cursor: second.nextCursor!,
      });
      expect(third.posts.map((entry) => entry.postId)).toEqual(["post-5"]);
      // Null only when there is nothing newer — the agent's stop signal.
      expect(third.nextCursor).toBeNull();
    }),
  );

  it.effect("rejects an out-of-range read limit at the schema, before any read", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      for (const limit of [5000, 0, -1]) {
        yield* harness.call("comms_read_channel", { channel: "seniors", limit }).pipe(Effect.flip);
      }
      // Rejected on the way in, so the gateway is never asked for an unbounded page.
      expect(yield* Ref.get(harness.reads)).toEqual([]);
    }),
  );

  it.effect("accepts the documented maximum", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.call("comms_read_channel", { channel: "seniors", limit: 200 });
      expect((yield* Ref.get(harness.reads))[0]?.limit).toEqual(200);
    }),
  );

  it.effect("defaults the read limit when the agent omits it", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.call("comms_read_channel", { channel: "seniors" });
      expect((yield* Ref.get(harness.reads))[0]?.limit).toEqual(50);
    }),
  );
});

describe("comms toolkit gateway failure mapping", () => {
  it.effect("reports a store failure on read as a read failure carrying the detail", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        failures: {
          readPosts: new ChannelGateway.ChannelStoreUnavailable({ detail: "projection lagging" }),
        },
      });
      const error = yield* harness
        .call("comms_read_channel", { channel: "seniors" })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "CommsReadFailedError", detail: "projection lagging" });
    }),
  );

  it.effect("marks a write conflict retryable and a store failure not", () =>
    Effect.gen(function* () {
      const conflicted = yield* makeHarness({
        failures: {
          createPost: new ChannelGateway.ChannelWriteConflict({ detail: "append raced" }),
        },
      });
      const retryable = yield* conflicted
        .call("comms_post", { channel: "seniors", body: "x" })
        .pipe(Effect.flip);
      expect(retryable).toMatchObject({ _tag: "CommsPostFailedError", retryable: true });

      const unavailable = yield* makeHarness({
        failures: {
          createPost: new ChannelGateway.ChannelStoreUnavailable({ detail: "no store" }),
        },
      });
      const terminal = yield* unavailable
        .call("comms_post", { channel: "seniors", body: "x" })
        .pipe(Effect.flip);
      expect(terminal).toMatchObject({ _tag: "CommsPostFailedError", retryable: false });
    }),
  );

  it.effect("surfaces membership revoked between the check and the write", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        failures: { createPost: new ChannelGateway.ChannelMembershipRevoked() },
      });
      const error = yield* harness
        .call("comms_post", { channel: "seniors", body: "x" })
        .pipe(Effect.flip);
      // The handler's pre-check passed; the aggregate is the guarantee.
      expect(error).toMatchObject({ _tag: "CommsMembershipLostError" });
    }),
  );

  it.effect("surfaces an aggregate-side unresolvable mention as a member error", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        failures: {
          createPost: new ChannelGateway.ChannelMentionUnresolvable({ handles: ["ghost"] }),
        },
      });
      const error = yield* harness
        .call("comms_post", { channel: "seniors", body: "x" })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "CommsMemberNotFoundError", handles: ["ghost"] });
    }),
  );

  it.effect("turns a gateway defect into a failed tool call, not a crash", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ failures: { dieOn: "createPost" } });
      const error = yield* harness
        .call("comms_post", { channel: "seniors", body: "x" })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "CommsPostFailedError" });
    }),
  );
});

describe("comms toolkit helpers", () => {
  it("normalizes channel names written with or without #, and with a space after it", () => {
    expect(normalizeChannelName("#seniors")).toEqual("seniors");
    expect(normalizeChannelName("  seniors  ")).toEqual("seniors");
    expect(normalizeChannelName("##seniors")).toEqual("seniors");
    expect(normalizeChannelName("# seniors")).toEqual("seniors");
    expect(normalizeChannelName("#")).toEqual("");
    expect(normalizeChannelName("#   ")).toEqual("");
  });

  it("collapses duplicate mentions to one normalized handle", () => {
    expect(resolveMentions(["@boss1", "boss1", "  @boss1  "], MEMBERS)).toEqual({
      handles: ["boss1"],
    });
  });

  it("emits the normalized handle so sigil-differing members cannot collapse", () => {
    // Keying on the normalized form and emitting the raw one would resolve this
    // mention to whichever member happened to be last.
    expect(
      resolveMentions(
        ["boss1"],
        [
          { handle: "boss1", memberKind: "thread", memberId: "thread-a" },
          { handle: "@boss1", memberKind: "human", memberId: "human-b" },
        ],
      ),
    ).toEqual({ handles: ["boss1"] });
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
