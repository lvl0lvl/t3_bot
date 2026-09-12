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
    | ChannelGateway.ChannelMentionUnresolvable
    | ChannelGateway.ChannelArchived;
  /** Raised as a DEFECT rather than a typed failure. */
  readonly dieOn?: "getChannel" | "createPost" | "readPosts" | "getPost";
}

interface HarnessOptions {
  readonly channels?: ReadonlyArray<{
    readonly name: string;
    readonly archivedAt?: string;
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
                archivedAt: channel.archivedAt ?? null,
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
      //
      // DIGITS, like the live layer's, rather than a post id. The two used to
      // disagree about what a cursor even is - this one looked the cursor up
      // by postId, and `findIndex` returning -1 for an unknown cursor made
      // `-1 + 1` the FIRST page, where the live layer returns an empty one. A
      // fake that answers a bad input differently from the thing it stands in
      // for is the one place a paging bug can hide from both.
      readPosts: (input) =>
        die("readPosts").pipe(
          Effect.andThen(fail.readPosts ? Effect.fail(fail.readPosts) : Effect.void),
          Effect.andThen(Ref.update(reads, (seen) => [...seen, input])),
          Effect.map(() => {
            const startIndex = input.cursor === undefined ? 0 : Number(input.cursor);
            const page = allPosts.slice(startIndex, startIndex + input.limit);
            const consumed = startIndex + page.length;
            return {
              posts: page,
              nextCursor: consumed < allPosts.length ? String(consumed) : null,
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
      // Before the LOOKUP, not merely before the write. A credential without
      // the comms capability that still reaches the channel store has probed
      // it — asserting only on `created` passes whether the check runs first
      // or last, because a refused call writes nothing either way.
      expect(yield* Ref.get(harness.channelLookups)).toEqual([]);
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
          threadId: THREAD_ID,
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
      // The credential's thread, which the live layer passes as the command's
      // ISSUER rather than as a field on it. The seam used to carry an
      // authorRef for the layer to translate, and translating it into a field
      // that no longer exists is how a correct-looking gateway ends up
      // refusing every post for want of an issuer.
      expect((yield* Ref.get(harness.created)).map((input) => input.threadId)).toEqual([
        THREAD_ID,
        OTHER_THREAD_ID,
      ]);
    }),
  );

  it.effect("says a channel is ARCHIVED rather than missing, to a member who can see it", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        channels: [
          { name: "seniors", archivedAt: "2026-09-11T00:00:00.000Z", memberThreadIds: [THREAD_ID] },
        ],
        failures: { createPost: new ChannelGateway.ChannelArchived() },
      });
      const error = yield* harness
        .call("comms_post", { channel: "seniors", body: "anyone still here" })
        .pipe(Effect.flip);

      // READABLE, NOT POSTABLE. The caller resolved this channel to get here,
      // so it can see the channel exists; "no such channel" would be false to
      // the one reader able to check, and would send it to comms_read_channel,
      // which would show the channel and no reason for the refusal. That is the
      // loop this area has already shipped once.
      expect(error).toMatchObject({ _tag: "CommsChannelArchivedError", channel: "seniors" });
      expect((error as { message: string }).message).toContain("archived");
      expect((error as { message: string }).message).toContain("Nothing was posted");
      // And it names WHICH channel: an agent is in several, and a refusal that
      // does not say which one it may no longer post to is not actionable.
      expect((error as { message: string }).message).toContain("seniors");

      // Reading it still works. That is the half that makes the distinction
      // worth having rather than a nicer word for the same refusal.
      const read = yield* harness.call("comms_read_channel", { channel: "seniors" });
      expect(read.channel).toBe("seniors");
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

  it.effect("names the canonical form it looked for, not what the agent typed", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness
        .call("comms_post", { channel: "# #Cafe\u0301  ", body: "x" })
        .pipe(Effect.flip);
      // The one diagnostic this error can carry. It is deliberately the same
      // answer a non-member gets, so the agent cannot be told WHY it missed —
      // but it can be told WHAT was looked up, and an agent that sees a
      // canonical form it did not type learns the rule from the failure.
      expect(error).toMatchObject({
        _tag: "CommsChannelNotFoundError",
        channel: "caf\u00E9",
      });
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
      // A sigil hiding behind whitespace a previous strip exposed. One pass
      // leaves the second "#" on forever, which is what makes this rule a
      // fixpoint rather than a sequence of steps.
      ["# #seniors", "seniors"],
      ["#  #  x", "x"],
      // Only sigils and whitespace: empty. The toolkit rejects these before any
      // lookup; the decider rejects them rather than storing a nameless channel.
      ["#", ""],
      ["##", ""],
      ["#   ", ""],
      // A sigil that is not leading is part of the name, not decoration.
      // Composed and decomposed spellings of one name are one channel. The
      // decider normalizes to NFC on the way in, so a lookup that does not
      // is a lookup that misses a channel that exists.
      ["Caf\u00E9", "caf\u00E9"],
      ["Cafe\u0301", "caf\u00E9"],
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

  it.effect("emits the stored handle, whatever case the agent typed", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        // A row the aggregate would refuse to store TODAY - it canonicalises
        // every handle on the way in - and one a read model can still hold from
        // before that rule. The fixture is deliberately that shape: it is the
        // only shape where emitting the key and emitting the stored bytes
        // differ, which is the rule under test.
        members: [{ handle: "Boss1", memberKind: "thread", memberId: OTHER_THREAD_ID }],
      });
      const result = yield* harness.call("comms_post", {
        channel: "seniors",
        body: "over to you",
        mentions: ["@Boss1"],
      });
      // Byte-identical to the stored handle, because that is what the aggregate
      // compares against. Emitting the canonical key instead makes the post
      // fail as a whole against a row like this one: requireChannelMentionsResolve
      // tests an exact Set, so the agent is told the member it just named does
      // not exist — under a name it never typed.
      //
      // The lookup folds; the OUTPUT does not. Those are different halves and
      // the comment that used to be here ran them together.
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
      // The SHAPE the tool will accept back, not the fake's internal value: a
      // cursor is opaque to the agent, and asserting the exact string here
      // pinned this fake's convention rather than the contract. The proof it
      // is usable is that the next call below is made with it.
      expect(first.nextCursor).toMatch(/^[0-9]+$/);

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

  it.effect("carries the refusal's own retryability rather than deciding it", () =>
    Effect.gen(function* () {
      // RETRYABILITY IS A PROPERTY OF THE REFUSAL, not of the tag. The layer
      // that saw the failure knows whether trying again could work; this one
      // would be guessing, and guessing "yes" is an instruction to loop on a
      // post that can never land.
      const conflicted = yield* makeHarness({
        failures: {
          createPost: new ChannelGateway.ChannelWriteConflict({
            detail: "append raced",
            retryable: true,
          }),
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

      // The same tag, the other way: a conflict the layer knows is permanent
      // must not tell the agent to try again. Without this the mapping could
      // hardcode `true` and both assertions above would still pass.
      const permanent = yield* makeHarness({
        failures: {
          createPost: new ChannelGateway.ChannelWriteConflict({
            detail: "Mentions do not resolve to members of channel 'channel-seniors': ghost.",
            retryable: false,
          }),
        },
      });
      const noRetry = yield* permanent
        .call("comms_post", { channel: "seniors", body: "x" })
        .pipe(Effect.flip);
      expect(noRetry).toMatchObject({ _tag: "CommsPostFailedError", retryable: false });
      expect((noRetry as { message: string }).message).not.toContain("Try again");
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

  it("gives an exactly-spelled handle to the member who owns it", () => {
    // "boss1" and "@boss1" share a canonical key, and the forgiving map keeps
    // whichever came last. Without exact-match precedence an agent naming the
    // FIRST member byte-for-byte woke the second one and was told it worked —
    // a different memberId, on a call returning success.
    const members: ReadonlyArray<ChannelGateway.ChannelMember> = [
      { handle: "boss1", memberKind: "thread", memberId: "thread-a" },
      { handle: "@boss1", memberKind: "human", memberId: "human-b" },
    ];
    expect(resolveMentions(["boss1"], members)).toEqual({ handles: ["boss1"] });
    expect(resolveMentions(["@boss1"], members)).toEqual({ handles: ["@boss1"] });
    // Both in one post: keying the dedupe on the canonical form would drop the
    // second, which is the silent half of the same bug.
    expect(resolveMentions(["boss1", "@boss1"], members)).toEqual({
      handles: ["boss1", "@boss1"],
    });
  });

  it("falls back to insertion order only when no spelling matches exactly", () => {
    // The case where the key really does carry no distinction: "@@boss1"
    // canonicalizes onto the shared key and is byte-identical to neither
    // member, so there is nothing to choose between them and last-writer-wins
    // is as good an answer as any. Asserted so that if it ever stops being
    // arbitrary, someone has to say why.
    //
    // Case IS a route here now, which is why this fixture still has something
    // to say: "BOSS1" also canonicalizes onto the shared key and lands on the
    // same arbitrary member. The parenthetical that used to be here said the
    // opposite, and stayed after the fold went back in.
    expect(
      resolveMentions(
        ["@@boss1"],
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

  it("treats an invisible twin as a separate member, which is the open gap", () => {
    // KNOWN GAP, asserted so it is visible where someone would meet it rather
    // than only in a bead. String.trim removes 25 code points and NOT ONE
    // control or format character, so a zero-width space survives every step
    // of canonicalisation: "\u200Bboss1" is a distinct key that RENDERS as
    // "boss1" in the member list comms_read_channel hands the agent.
    //
    // Exact-match precedence makes this as much this file's problem as the
    // aggregate's: the two spellings reach different members,
    // deterministically, while an agent choosing between them is reading
    // identical text. The forbidden-character rule now lives in
    // the shared identity module and is applied where identities are CREATED:
    // requireCanonicalChannelHandle refuses a handle carrying one, so the twin
    // below can no longer be stored. This still asserts the behaviour, because
    // the gateway's membership is a read model and can hold rows written
    // before that rule existed.
    const members: ReadonlyArray<ChannelGateway.ChannelMember> = [
      { handle: "\u200Bboss1", memberKind: "human", memberId: "human-twin" },
      { handle: "boss1", memberKind: "thread", memberId: OTHER_THREAD_ID },
    ];
    expect(resolveMentions(["boss1"], members)).toEqual({ handles: ["boss1"] });
    expect(resolveMentions(["\u200Bboss1"], members)).toEqual({
      handles: ["\u200Bboss1"],
    });
  });

  it("folds case on a handle, because the aggregate now stores handles folded", () => {
    // The flip this test was written to make. Its previous form asserted the
    // opposite and said so: the fold was reverted in PR #5 because the
    // aggregate keyed handles byte-exactly, so folding here made every
    // capitalised mention unresolvable and refused the post whole. The
    // aggregate canonicalises handles now - decider.ts runs
    // requireCanonicalChannelHandle on channel.create, channel.member.add,
    // channel.member.remove and channel.post.create - so this side follows.
    // Order was the whole risk, and the aggregate went first.
    const members: ReadonlyArray<ChannelGateway.ChannelMember> = [
      { handle: "boss1", memberKind: "thread", memberId: OTHER_THREAD_ID },
    ];
    expect(resolveMentions(["Boss1"], members)).toEqual({ handles: ["boss1"] });
    expect(resolveMentions(["@BOSS1"], members)).toEqual({ handles: ["boss1"] });

    // A row written BEFORE the aggregate folded keeps its own bytes, and the
    // lookup still reaches it. What goes out is still what is STORED, never
    // the key - the rule that makes this side correct for whatever the read
    // model holds rather than correct only while both sides agree.
    //
    // It does not make such a member mentionable: the decider canonicalises
    // the mention and compares it to the stored handle, so "Boss1" resolves
    // here and is refused there. See docs/internals/channel-identity.md.
    const legacy: ReadonlyArray<ChannelGateway.ChannelMember> = [
      { handle: "Boss1", memberKind: "thread", memberId: OTHER_THREAD_ID },
    ];
    expect(resolveMentions(["boss1"], legacy)).toEqual({ handles: ["Boss1"] });

    // And this row reaches its member through the FORGIVING map, not through
    // exact-match precedence: "Boss1" keys "boss1" there too. Said out loud
    // because the precedence's own docstring used to claim this case as its
    // justification, which would have let a maintainer test the guard, find it
    // redundant here, and delete the collision behaviour it actually buys.
  });

  it("gives a padded exact spelling to the member who owns it, not to a collided twin", () => {
    // The trim in `byExactHandle.get(entry.trim())` kills NOTHING in the suite -
    // found by mutation, not by reading - and it is load-bearing on exactly one
    // input: a roster where two members share a canonical key, where the
    // forgiving map keeps whichever came last.
    //
    // NOT A FAKED STATE, which is the question worth asking of any fixture the
    // aggregate would refuse. requireChannelHandlesUnique runs on canonical
    // handles now, so a channel cannot be CREATED this way - but this membership
    // comes from a read model, which can hold rows written under an older form
    // of the rule. That is the same population the legacy row above belongs to.
    const collided: ReadonlyArray<ChannelGateway.ChannelMember> = [
      { handle: "@boss1", memberKind: "thread", memberId: OTHER_THREAD_ID },
      { handle: "boss1", memberKind: "human", memberId: "human-boss1" },
    ];
    // Both key on "boss1"; the map holds the second. Without the trim the
    // padded spelling misses the exact map and wakes the HUMAN - a different
    // memberId, on a call that returns success.
    expect(resolveMentions(["  @boss1  "], collided)).toEqual({ handles: ["@boss1"] });
    // The unpadded exact spelling reaches its own member either way, which is
    // why only the padded one distinguishes the implementations.
    expect(resolveMentions(["@boss1"], collided)).toEqual({ handles: ["@boss1"] });
  });

  it("reports an unresolved handle in canonical form, not as typed", () => {
    // The other half of the delivery rule, asserted because the docstring now
    // claims it: a RESOLVED handle goes out as stored bytes, an UNRESOLVED one
    // goes out canonical. Nothing compares against the latter, and it is the
    // only diagnostic the error can carry. Visually the two forms are
    // identical, which is why this needs an assertion rather than a reading.
    expect(resolveMentions(["@Rene\u0301x"], MEMBERS)).toEqual({
      unknown: ["ren\u00E9x"],
    });
  });

  it("reaches a member across Unicode composition, and emits what is stored", () => {
    // The decider normalizes to NFC, so a member is stored composed. An agent
    // typing the decomposed spelling - what a macOS paste produces - must
    // still reach them. Matching normalizes; the emitted handle does not, so
    // what goes out is the composed bytes the aggregate will match against.
    const members: ReadonlyArray<ChannelGateway.ChannelMember> = [
      { handle: "caf\u00E9", memberKind: "human", memberId: "human-cafe" },
    ];
    expect(resolveMentions(["@cafe\u0301"], members)).toEqual({
      handles: ["caf\u00E9"],
    });
  });

  it("reaches a member whose handle has no canonical form, by its exact handle", () => {
    // "@" canonicalizes to nothing, so no forgiving spelling can reach it and
    // every attempt was silently dropped — while comms_read_channel offered it
    // as mentionable. Exact matching is what makes it addressable at all.
    expect(
      resolveMentions(["@"], [{ handle: "@", memberKind: "human", memberId: "human-sigil" }]),
    ).toEqual({ handles: ["@"] });
  });

  it("does not wake that member with formatting noise", () => {
    // The mirror of the test above, and the reason the canonical map refuses an
    // empty key: "   " and "@@" also canonicalize to nothing, so a member
    // stored "@" would be woken by a stray space on a post addressed to nobody.
    const members: ReadonlyArray<ChannelGateway.ChannelMember> = [
      { handle: "@", memberKind: "human", memberId: "human-sigil" },
    ];
    expect(resolveMentions(["   "], members)).toEqual({ handles: [] });
    expect(resolveMentions(["@@"], members)).toEqual({ handles: [] });
  });

  it("ignores an empty mention rather than failing the post", () => {
    expect(resolveMentions(["@", "  ", "boss1"], MEMBERS)).toEqual({ handles: ["boss1"] });
  });
});
