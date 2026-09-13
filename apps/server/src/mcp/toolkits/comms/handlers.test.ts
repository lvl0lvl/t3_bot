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
import { CommsToolkit, CURSOR_PATTERN } from "./tools.ts";

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

/**
 * A cursor's THREE parts, or nulls where a part is not one.
 *
 * Deliberately as strict as the live layer's `decodeCursor` about the digits:
 * `Number("")` is 0 and `Number("0x2")` is 2, so a fake that used `Number`
 * directly would answer a page for a cursor the real gateway refuses - which is
 * the divergence this whole fake is written to avoid.
 *
 * THE DIRECTION IS THE THIRD PART (`t3_bot-2oh`). A cursor points AFTER its
 * page going forward and BEFORE it going backward, so the live layer refuses
 * one used in the other direction; a fake that still parsed two parts would
 * answer a page for exactly that cursor, which is the divergence above with a
 * different field in it.
 */
const splitCursor = (
  cursor: string | undefined,
): readonly [string | null, string | null, number | null] => {
  if (cursor === undefined) return [null, null, null];
  const boundary = cursor.indexOf(":");
  if (boundary === -1) return [cursor, null, null];
  const rest = cursor.slice(boundary + 1);
  const directionBoundary = rest.indexOf(":");
  if (directionBoundary === -1) return [cursor.slice(0, boundary), null, null];
  const digits = rest.slice(directionBoundary + 1);
  return [
    cursor.slice(0, boundary),
    rest.slice(0, directionBoundary),
    /^[0-9]+$/.test(digits) ? Number(digits) : null,
  ];
};

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
  const channelLookups = yield* Ref.make<
    ReadonlyArray<readonly [string, ChannelGateway.ChannelMemberRef]>
  >([]);

  const die = (op: GatewayFailures["dieOn"]) =>
    fail.dieOn === op ? Effect.die(new Error(`fake gateway defect in ${op}`)) : Effect.void;

  const gateway = Layer.succeed(
    ChannelGateway.ChannelGateway,
    ChannelGateway.ChannelGateway.of({
      getChannelForMember: (name, member) =>
        die("getChannel").pipe(
          Effect.andThen(fail.getChannel ? Effect.fail(fail.getChannel) : Effect.void),
          Effect.andThen(Ref.update(channelLookups, (seen) => [...seen, [name, member] as const])),
          Effect.as(
            Option.fromNullishOr(
              channels.find(
                (channel) =>
                  channel.name === name &&
                  // BOTH FIELDS, like the live layer. A fake that matched on
                  // memberId alone would answer the colliding roster
                  // differently from the thing it stands in for, which is where
                  // the last paging bug hid.
                  member.memberKind === "thread" &&
                  channel.memberThreadIds.includes(member.memberId),
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
          Effect.flatMap(() => {
            // THE SAME SHAPE THE LIVE LAYER ISSUES, `${channelId}:${n}`, not a
            // bare number. The two used to disagree about what a cursor even
            // IS - this one looked posts up by id while the live layer used a
            // sequence - and a fake that answers a different shape from the
            // thing it stands in for is where a paging bug hides from both.
            // It cost a schema change to notice; it is cheaper to keep them
            // aligned than to rediscover the divergence.
            //
            // AND THE SAME SEMANTICS, which aligning the FORMAT alone did not
            // buy and which a verifier caught: this used to take
            // `cursor.split(":")[1]` and throw the channel half away, so a
            // cursor issued by another channel was answered here with this
            // channel's first page and a fresh cursor - the exact defect
            // `t3_bot-e60` fixed in the live layer, still live in the fake that
            // 43 tests run against. The refusal branch the handlers gained for
            // it was unreachable in this file.
            const [issuedBy, issuedFor, digits] = splitCursor(input.cursor);
            // AND THE REASON, IN THE LIVE DECODER'S ORDER. The handler turns this
            // word into the sentence the agent reads, so a fake that refuses
            // correctly while blaming the wrong cause reproduces `t3_bot-2oh`
            // instead of guarding against it: shape first, then the channel, then
            // the direction — a cursor wrong on both axes is the other channel's.
            const refusal =
              input.cursor === undefined
                ? undefined
                : digits === null
                  ? "malformed"
                  : issuedBy !== input.channelId
                    ? "channel"
                    : issuedFor !== input.direction
                      ? "direction"
                      : undefined;
            if (input.cursor !== undefined && refusal !== undefined) {
              return Effect.fail(
                new ChannelGateway.ChannelCursorUnusable({
                  cursor: input.cursor,
                  channelId: input.channelId,
                  reason: refusal,
                }),
              );
            }
            // DIRECTION IS HONOURED, for the same reason. Ignoring it - which
            // this did - means a handler flipped to "backward" reds nothing
            // here, and the whole point of the fake is that the handler's
            // choices are visible in it.
            const backward = input.direction === "backward";
            const end = digits === null ? allPosts.length : digits;
            const start = digits === null ? 0 : digits;
            const page = backward
              ? allPosts.slice(Math.max(0, end - input.limit), end)
              : allPosts.slice(start, start + input.limit);
            const boundary = backward ? end - page.length : start + page.length;
            const exhausted = backward ? boundary <= 0 : boundary >= allPosts.length;
            return Effect.succeed({
              posts: page,
              nextCursor: exhausted ? null : `${input.channelId}:${input.direction}:${boundary}`,
            } satisfies ChannelGateway.ChannelPage);
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
      // NO GATEWAY FAILURE in this fixture. `publish` decides archived from
      // the channel it already proved membership on, so the gateway is never
      // reached - and a `failures.createPost` here would be dead weight that
      // made this test look like it covered the gateway branch too. It does
      // not; the test below does.
      const harness = yield* makeHarness({
        channels: [
          { name: "seniors", archivedAt: "2026-09-11T00:00:00.000Z", memberThreadIds: [THREAD_ID] },
        ],
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

  it.effect("maps the gateway's ARCHIVED refusal, for the race the pre-check cannot see", () =>
    Effect.gen(function* () {
      // NOT archived in the read model, so `publish`'s pre-check passes and the
      // gateway is actually called. That is the only fixture that reaches
      // `onCreateFailure.ChannelArchived`, and it is the real state: a channel
      // archived between the membership read and the dispatch.
      //
      // It exists because adding the pre-check disarmed the test that used to
      // cover this. That fixture set archivedAt AND a gateway failure, so the
      // pre-check short-circuited and the mapping could be pointed at any error
      // in the union with all 65 comms tests still green.
      const harness = yield* makeHarness({
        channels: [{ name: "seniors", memberThreadIds: [THREAD_ID] }],
        failures: { createPost: new ChannelGateway.ChannelArchived() },
      });
      const error = yield* harness
        .call("comms_post", { channel: "seniors", body: "lost the race" })
        .pipe(Effect.flip);

      expect(error).toMatchObject({ _tag: "CommsChannelArchivedError", channel: "seniors" });
      expect((error as { message: string }).message).toContain("archived");
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
      expect(yield* Ref.get(harness.channelLookups)).toEqual([
        // THE KIND TOO, not just the id. The toolkit derives the ref from
        // its credential, so "thread" here is the assertion that the
        // handler did not take a member from the tool call.
        ["seniors", { memberKind: "thread", memberId: THREAD_ID }],
      ]);
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
      expect(yield* Ref.get(harness.channelLookups)).toEqual([
        // THE KIND TOO, not just the id. The toolkit derives the ref from
        // its credential, so "thread" here is the assertion that the
        // handler did not take a member from the tool call.
        ["seniors", { memberKind: "thread", memberId: THREAD_ID }],
      ]);
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
        postable: true,
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
      //
      // THE TOOL'S OWN PATTERN, not a copy of it. This was a hand-written
      // duplicate, and when `t3_bot-2oh` added a direction segment the copy
      // kept asserting the old two-part shape — a test pinning "what the tool
      // accepts" against a regex the tool no longer uses.
      expect(first.nextCursor).toMatch(CURSOR_PATTERN);

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

  it.effect("does not blame the channel for a cursor the channel issued", () =>
    Effect.gen(function* () {
      const many = Array.from({ length: 5 }, (_, index) => post(`post-${index + 1}`));
      const harness = yield* makeHarness({ posts: many });

      // THE SENTENCE WAS FALSE AND NOTHING WAS RED. Three gateway refusals —
      // another channel's cursor, the other direction's, and a malformed one —
      // arrived here as one error carrying no reason, and the one sentence
      // written for the first of them was served to all three. An agent holding
      // a cursor `seniors` had issued was told `seniors` had not issued it, and
      // the only assertions on this message were `toContain("seniors")` and
      // `toContain("without a cursor")`, which the false sentence and the true
      // one both satisfy (`t3_bot-2oh`).
      //
      // BUILT FROM THE REAL CURSOR rather than hand-spelled: flipping the
      // direction word in a cursor this channel just issued is the one edit that
      // leaves the channel half and the sequence exactly as the gateway wrote
      // them, so nothing but the direction can be what is refused.
      const first = yield* harness.call("comms_read_channel", { channel: "seniors", limit: 2 });
      const otherDirection = first.nextCursor!.replace(":forward:", ":backward:");
      expect(otherDirection).not.toBe(first.nextCursor);

      const refused = yield* harness
        .call("comms_read_channel", { channel: "seniors", cursor: otherDirection })
        .pipe(Effect.flip);

      expect((refused as { _tag: string })._tag).toBe("CommsCursorUnusableError");
      const message = (refused as { message: string }).message;
      expect(message).toContain("in the other direction");
      // THE NEGATIVE IS THE POINT. The tag, the channel name and the recovery
      // clause are identical either way; the false clause is the only thing that
      // changed, so it is the only thing that can catch its return.
      expect(message).not.toContain("was not issued by");
      // And the recovery it depends on is still there, since a true explanation
      // with no next step is its own failure.
      expect(message).toContain("without a cursor");
    }),
  );

  it.effect("turns the gateway's foreign-cursor refusal into the agent-facing one", () =>
    Effect.gen(function* () {
      const many = Array.from({ length: 5 }, (_, index) => post(`post-${index + 1}`));
      const harness = yield* makeHarness({ posts: many });

      // THE BRANCH THIS FILE COULD NOT REACH. `readFailures` gained a
      // `ChannelCursorUnusable` clause in this PR and the fake could not
      // produce one, because it parsed `cursor.split(":")[1]` and threw the
      // channel half away - answering a foreign cursor with this channel's
      // first page, which is the very defect `t3_bot-e60` fixes in the live
      // layer. 43 tests ran against that fake. Found by a verifier, not by
      // reading the comment directly above it saying fakes must not diverge.
      // THREE PARTS, so the refusal under test is the one about PROVENANCE.
      // A two-part value is admitted by the schema on purpose and refused by
      // the decoder as "malformed" (`t3_bot-2oh`), so it would still fail here
      // — with the wrong reason, and the assertions below read the sentence.
      const foreign = "channel-somewhere-else:forward:2";
      const refused = yield* harness
        .call("comms_read_channel", { channel: "seniors", cursor: foreign })
        .pipe(Effect.flip);

      // The tag the AGENT sees, and the one it must not: `CommsReadFailedError`
      // is the retryable one, and telling an agent to retry a cursor that can
      // never work is the loop this area exists to stop.
      expect((refused as { _tag: string })._tag).toBe("CommsCursorUnusableError");
      // AND THE SENTENCE, which is the whole product here — the agent acts on
      // prose, not on a tag. True for THIS cursor: another channel issued it.
      expect((refused as { message: string }).message).toContain(
        "That cursor was not issued by 'seniors'.",
      );
      expect((refused as { _tag: string })._tag).not.toBe("CommsReadFailedError");
      // Not a page. An empty page with a null cursor is what the old coercion
      // produced and is indistinguishable from being caught up.
      expect(refused).not.toMatchObject({ posts: [], nextCursor: null });

      // And this channel's own cursor still pages, so the assertion above is
      // about provenance rather than about the fake refusing every cursor.
      const first = yield* harness.call("comms_read_channel", { channel: "seniors", limit: 2 });
      const second = yield* harness.call("comms_read_channel", {
        channel: "seniors",
        limit: 2,
        cursor: first.nextCursor!,
      });
      expect(second.posts.map((entry) => entry.postId)).toEqual(["post-3", "post-4"]);
    }),
  );

  it.effect("asks the gateway to read FORWARD, which is what the tool documents", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.call("comms_read_channel", { channel: "seniors" });

      // `comms_read_channel` documents "oldest first". The fake used to ignore
      // `direction` entirely, so flipping the handler to "backward" - a silent
      // change to what catching up MEANS - reddened nothing anywhere.
      expect((yield* Ref.get(harness.reads))[0]?.direction).toBe("forward");
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

  it.effect("tells the agent not to retry a post whose channel read hit a store failure", () =>
    Effect.gen(function* () {
      // THE WRITE PATH'S store failure lands on the membership read, not on
      // the append: `createPost` performs no read of its own. It is told as a
      // post failure, and not retryable — a mapping hardcoded to `true` here
      // was pinned by nothing once `createPost` stopped declaring the tag.
      const harness = yield* makeHarness({
        failures: {
          getChannel: new ChannelGateway.ChannelStoreUnavailable({ detail: "no store" }),
        },
      });
      const error = yield* harness
        .call("comms_post", { channel: "seniors", body: "x" })
        .pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "CommsPostFailedError",
        detail: "no store",
        retryable: false,
      });
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
    // aggregate would refuse. requireChannelMembersUnique runs on canonical
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

/**
 * The pattern, read directly, because every other assertion on it is indirect.
 *
 * Everything `CURSOR_PATTERN` refuses is refused AGAIN by `decodeChannelCursor`,
 * so replacing the whole check with `/^[\s\S]*$/` leaves every cursor test in
 * this repository green: the tool still fails, one door further down. The guard
 * is not about whether a bad cursor is caught, it is about WHICH error the agent
 * is handed, and only reading the pattern itself can measure that.
 */
describe("CURSOR_PATTERN", () => {
  it("admits what the encoder writes, in both directions", () => {
    expect(CURSOR_PATTERN.test("channel-seniors:forward:12")).toBe(true);
    expect(CURSOR_PATTERN.test("channel-seniors:backward:12")).toBe(true);
    // Zero is a sequence; a bound of one digit is still a bound.
    expect(CURSOR_PATTERN.test("c:forward:0")).toBe(true);
  });

  it("admits a cursor issued before the direction existed", () => {
    // ON PURPOSE, and refused by the gateway rather than here (`t3_bot-2oh`).
    // Matching the encoder exactly meant the schema turned a cursor this server
    // itself issued into an `AiError` quoting this regex, outside the tool's
    // declared error union and with no recovery in it. Admitted, the same value
    // reaches the decoder and comes back as "read again without a cursor,
    // nothing was lost". The sequence is never honoured either way.
    expect(CURSOR_PATTERN.test("channel-seniors:12")).toBe(true);
  });

  it("refuses the direction word it was not given", () => {
    // The alternation is a CLOSED set of two words. `[a-z]+` in its place reads
    // identically on every fixture the encoder produces and admits
    // "channel:sideways:1", which the decoder then refuses as a direction
    // mismatch - the right refusal at the wrong door, and the tell is gone.
    expect(CURSOR_PATTERN.test("channel-seniors:sideways:12")).toBe(false);
    expect(CURSOR_PATTERN.test("channel-seniors:Forward:12")).toBe(false);
    expect(CURSOR_PATTERN.test("channel-seniors:forwards:12")).toBe(false);
  });

  it("refuses a sequence that cannot survive the round trip", () => {
    // Fifteen digits is the widest bound that cannot overflow:
    // `Number.MAX_SAFE_INTEGER` has sixteen, and an unbounded `[0-9]+` admitted
    // "9007199254740993" - numeric, past every other check, and a sequence the
    // caller can never be given back.
    expect(CURSOR_PATTERN.test(`channel-seniors:forward:${"9".repeat(15)}`)).toBe(true);
    expect(CURSOR_PATTERN.test(`channel-seniors:forward:${"9".repeat(16)}`)).toBe(false);
  });

  it("refuses a channel half that would break the decoder's split", () => {
    // The split assumes no ":" inside a channel id, which is what
    // `OPAQUE_ID_PATTERN` guarantees and what this half re-spells so the
    // assumption is checkable here. Sixty-five characters is one past that
    // brand's own bound.
    expect(CURSOR_PATTERN.test("has spaces:forward:1")).toBe(false);
    expect(CURSOR_PATTERN.test("a:b:forward:1")).toBe(false);
    expect(CURSOR_PATTERN.test(`${"a".repeat(65)}:forward:1`)).toBe(false);
    expect(CURSOR_PATTERN.test(":forward:1")).toBe(false);
  });

  it("refuses the shapes an agent is most likely to send instead", () => {
    // A post id and a bare sequence, which are the two wrong values the result
    // shape makes easy: posts and cursors are both plain strings in it. The
    // trailing newline is here because `$` in JavaScript is NOT Python's: it
    // does not match before a final newline unless `m` is set, so a cursor
    // copied with a line break is refused rather than quietly honoured.
    for (const notACursor of [
      "post-2",
      "3",
      "seniors:",
      "",
      "  ",
      "channel:forward:",
      "channel-a:forward:1\n",
    ]) {
      expect(CURSOR_PATTERN.test(notACursor)).toBe(false);
    }
  });
});
