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
import { CommsToolkitHandlersLive, canonicalChannelName, resolveMentions } from "./handlers.ts";
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
  /** Overridden only where a handle's exact bytes are the thing under test. */
  readonly members?: ReadonlyArray<ChannelGateway.ChannelMember>;
}

const makeHarness = Effect.fn("makeCommsToolkitHarness")(function* (options: HarnessOptions = {}) {
  const channels = options.channels ?? [
    { name: "seniors", memberThreadIds: [THREAD_ID, OTHER_THREAD_ID, "thread-pm"] },
  ];
  const allPosts = options.posts ?? [];
  const fail = options.failures ?? {};
  const members = options.members ?? MEMBERS;
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
                members,
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
      // The assertion the comment above always meant: no LOOKUP, not no write.
      // `created` records posts; a gateway called with "" and answering None
      // writes nothing either, so asserting on it passed whether the guard ran
      // before the lookup or after it.
      expect(yield* Ref.get(harness.channelLookups)).toEqual([]);
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
   * THE SHARED CANONICAL TABLE. One rule, two implementations: this one and
   * the decider's `canonicalChannelName`. They have already disagreed — the
   * toolkit stripped every leading sigil and the decider stripped one, so
   * `##seniors` reached two different channels depending on which you asked.
   *
   * The decider is meant to assert this same list; until it does, this table
   * pins one side of a rule that spans two, and agreement is still checked by
   * hand. Do not read a green here as the two sides agreeing.
   *
   * Rule (pm, 2026-09-11): trim, strip all leading sigils, trim, lowercase.
   */
  it("canonicalizes a channel name the way the aggregate stores it", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["seniors", "seniors"],
      ["  seniors  ", "seniors"],
      ["#seniors", "seniors"],
      ["##seniors", "seniors"],
      ["###a", "a"],
      // Case alone, with and without a sigil: the reason this rule exists.
      ["Seniors", "seniors"],
      ["#SENIORS", "seniors"],
      ["  ##SENIORS  ", "seniors"],
      ["# seniors", "seniors"],
      // Only sigils and whitespace: empty. The toolkit rejects these before any
      // lookup; the decider rejects them rather than storing a nameless channel.
      ["#", ""],
      ["##", ""],
      ["#   ", ""],
      // A sigil that is not leading is part of the name, not decoration.
      ["#-#", "-#"],
      ["a#b", "a#b"],
    ];
    // Paired with the input so a failure names the row that moved, and paired
    // rather than joined into one string because five of these rows expect an
    // empty or whitespace-only result. Joined, a leaked space reads as
    // `"# seniors ->  seniors"` and is invisible; paired, the quotes delimit it.
    expect(cases.map(([input]) => [input, canonicalChannelName(input)])).toEqual(
      cases.map(([input, want]) => [input, want]),
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

  it.effect("passes a mention through with its case intact", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        // A handle the aggregate accepts and stores as typed: ChannelMemberHandle
        // is a trimmed non-empty string with no case rule.
        members: [{ handle: "Boss1", memberKind: "thread", memberId: OTHER_THREAD_ID }],
      });
      const result = yield* harness.call("comms_post", {
        channel: "seniors",
        body: "over to you",
        mentions: ["@Boss1"],
      });
      // Byte-identical to the stored handle, because that is what the aggregate
      // compares against. Folding case here makes the post fail as a whole:
      // requireChannelMentionsResolve tests an exact Set, so "boss1" resolves to
      // nobody and the agent is told the member it just named does not exist —
      // under a name it never typed. Channel NAMES fold; handles do not, until
      // the aggregate canonicalizes them (t3_bot-iin).
      expect(result.mentioned).toEqual(["Boss1"]);
      expect((yield* Ref.get(harness.created))[0]?.mentions).toEqual(["Boss1"]);
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
      // Deliberately NOT the default fixture. Those handles are already their
      // own normalized form, so the assertion passed whether the read path
      // normalized them, folded them, or did nothing at all — a guard with no
      // sensitivity to the thing it guards.
      //
      // Each of these is legal: ChannelMemberHandle is a branded
      // TrimmedNonEmptyString and imposes nothing else. Between them they pin
      // that the read path strips LEADING sigils and changes NOTHING else —
      // not case, not a trailing sigil, not internal spacing, and not Unicode
      // form. Three of them cover Unicode, and it takes three: the fullwidth B
      // catches NFKC and NFKD, the COMPOSED e catches NFD, and the DECOMPOSED
      // e catches NFC — no single string catches both NFC and NFD, because a
      // string is stable under one exactly when it moves under the other. NFC
      // is the one that matters most: "normalize before comparing" is standard
      // advice and NFC is what people reach for, so the axis most likely to be
      // added is the axis a composed-only fixture cannot see. Every one of those is "one more normalization
      // step, surely harmless" — the exact shape of the regression this echo
      // already carried once.
      const harness = yield* makeHarness({
        members: [
          { handle: "@@PM", memberKind: "thread", memberId: "thread-pm" },
          { handle: "Big  \uFF22oss@", memberKind: "human", memberId: "human-big-boss" },
          { handle: "Ren\u00E9e", memberKind: "human", memberId: "human-renee" },
          { handle: "Rene\u0301a", memberKind: "human", memberId: "human-renea" },
        ],
      });
      const result = yield* harness.call("comms_read_channel", { channel: "seniors" });
      // The stored bytes, unchanged — including the sigils. A mention is
      // matched against membership exactly, so a handle tidied on the way out
      // is a handle that resolves to nobody. This echo is the last place that
      // can be reintroduced silently, since nothing downstream reads it back.
      expect(result.members).toEqual(["@@PM", "Big  \uFF22oss@", "Ren\u00E9e", "Rene\u0301a"]);
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
  it("collapses duplicate spellings of one member to a single handle", () => {
    expect(resolveMentions(["@boss1", "boss1", "  @boss1  "], MEMBERS)).toEqual({
      handles: ["boss1"],
    });
  });

  it("emits the member's stored handle, not the form the agent typed", () => {
    // The agent types the convenient form; what goes out is what the channel
    // holds. Emitting the lookup key instead is only harmless while every
    // stored handle already equals its own key — for a member stored "@boss1"
    // the key is "boss1", which the aggregate matches against nobody, and the
    // post is rejected whole.
    expect(
      resolveMentions(["boss1"], [{ handle: "@boss1", memberKind: "human", memberId: "human-b" }]),
    ).toEqual({ handles: ["@boss1"] });
  });

  it("cannot distinguish two members whose handles share a lookup key", () => {
    // Recorded rather than fixed: "boss1" and "@boss1" collapse to one key, so
    // one of them is unreachable through a mention and which one is decided by
    // Map insertion order. The toolkit cannot invent a distinction the key does
    // not carry — the aggregate has to refuse the duplicate, which is what the
    // canonical uniqueness check on t3_bot-iin does. Until then this is the
    // honest behaviour, and asserting it means the day it changes, this fails.
    expect(
      resolveMentions(
        ["boss1"],
        [
          { handle: "boss1", memberKind: "thread", memberId: "thread-a" },
          { handle: "@boss1", memberKind: "human", memberId: "human-b" },
        ],
      ),
    ).toEqual({ handles: ["@boss1"] });
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
