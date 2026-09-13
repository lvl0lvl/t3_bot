/**
 * The toolkit against the REAL aggregate invariants.
 *
 * Every other comms test fakes the gateway and asserts what the toolkit sends.
 * This one imports the decider's actual `commandInvariants` and runs the
 * toolkit's output through them, because the two halves have diverged twice —
 * once on how many leading sigils a name loses, once on whether a handle is
 * case-folded — and both times every test on both sides stayed green.
 *
 * Written by the security lane against the aggregate as it was BEFORE handles
 * were canonicalised, and adapted here for the aggregate that landed: its
 * fixtures named members the decider now refuses ("Walt" and "walt" in one
 * channel) and asserted a case-shifted mention was unresolvable. Those were the
 * correct assertions for that aggregate and are the wrong ones for this one, so
 * the membership fixtures are now DERIVED from the decider's own
 * canonicalisation rather than asserted to be acceptable.
 *
 * WHAT IT PINS
 *   1. A name canonicalised by the toolkit is a name the decider stores.
 *   2. A handle emitted by comms_read_channel is a handle the decider resolves.
 *   3. Distinct members stay distinct end to end — no two of them collapse into
 *      one mention key.
 *   4. A non-member and a non-existent channel are one answer, byte for byte.
 *
 * WHAT IT SEES AGAIN, and the correction is worth keeping because this file's
 * subject is comments that drifted. An earlier version of this header said the
 * emit-the-lookup-key rule could no longer be seen here — that every test in
 * this file would stay green on that mutant, because canonical membership makes
 * the key and the stored bytes the same bytes. That was measured and true when
 * it was written, and the same change that fixed the fake falsified it: the fake
 * runs the decider's whole post path now, and one test here deliberately uses a
 * membership that is NOT canonical.
 *
 * Measured again rather than reasoned: emitting the lookup key reds ONE test
 * here and SEVEN in handlers.test.ts. A comment carrying a count has to be
 * re-run when the file grows, which is the argument for carrying the count
 * anyway — it is the kind of claim that announces its own staleness.
 */
import { ChannelId, EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";

// The real decider-side rules. If these move, this file must fail.
import {
  canonicalChannelName,
  requireCanonicalChannelHandle,
  requireCanonicalChannelMember,
  requireChannelMembersUnique,
  requireChannelMentionsResolve,
} from "../../../orchestration/commandInvariants.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ChannelGateway from "./channelGateway.ts";
import {
  CommsToolkitHandlersLive,
  canonicalChannelName as toolkitCanonicalChannelName,
  resolveMentions,
} from "./handlers.ts";
import { CommsToolkit } from "./tools.ts";

const THREAD_ID = ThreadId.make("thread-boss3");
const OTHER_THREAD_ID = ThreadId.make("thread-boss1");
const CHANNEL_ID = "channel-seniors";

const invocation = (threadId: ThreadId): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  threadId,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("claude"),
  capabilities: new Set<McpInvocationContext.McpCapability>(["comms"]),
  issuedAt: 1,
});

/**
 * A gateway wired the way the live one will be: name lookup against the
 * decider's canonical form with a byte comparison, and createPost forwarded to
 * the decider's own mention-resolution invariant. A fake that reimplements
 * either rule cannot see the two halves disagree, which is the whole point.
 */
const makeSeam = Effect.fn("commsSeam")(function* (opts: {
  readonly channelName: string;
  readonly members: ReadonlyArray<ChannelGateway.ChannelMember>;
  readonly memberThreadIds: ReadonlyArray<string>;
}) {
  const created = yield* Ref.make<ReadonlyArray<ChannelGateway.CreatePostInput>>([]);
  const channelLookups = yield* Ref.make<
    ReadonlyArray<readonly [string, ChannelGateway.ChannelMemberRef]>
  >([]);
  const deciderRejections = yield* Ref.make<ReadonlyArray<string>>([]);

  const gateway = Layer.succeed(
    ChannelGateway.ChannelGateway,
    ChannelGateway.ChannelGateway.of({
      getChannelForMember: (name, member) =>
        Ref.update(channelLookups, (seen) => [...seen, [name, member] as const]).pipe(
          Effect.as(
            name === canonicalChannelName(opts.channelName) &&
              member.memberKind === "thread" &&
              opts.memberThreadIds.includes(member.memberId)
              ? Option.some<ChannelGateway.Channel>({
                  channelId: CHANNEL_ID,
                  name: canonicalChannelName(opts.channelName),
                  // Live, because every test in this file is about a channel
                  // that can be posted to. The archived case is the toolkit's
                  // to refuse and is pinned in handlers.test.ts.
                  archivedAt: null,
                  members: opts.members,
                })
              : Option.none(),
          ),
        ),
      getPost: () => Effect.succeed(Option.none()),
      readPosts: () => Effect.succeed({ posts: [], nextCursor: null }),
      createPost: (input) =>
        Effect.gen(function* () {
          yield* Ref.update(created, (r) => [...r, input]);
          // ALL THREE STEPS, in the decider's order (decider.ts, case
          // "channel.post.create"): canonicalise every mention - which can
          // itself fail - then dedupe, then resolve.
          //
          // Running only the third made this a fake of the seam, which is the
          // one thing this file exists not to be. requireChannelMentionsResolve
          // does no canonicalising of its own; it is a bare Set.has over
          // member.handle. So the step that makes the two sides disagree never
          // ran, and on a membership stored in an older form this reported a
          // post LANDING where production rejects it whole.
          const verdict = yield* Effect.forEach(input.mentions, (handle) =>
            requireCanonicalChannelHandle({
              command: { type: "channel.post.create" } as never,
              handle,
            }),
          ).pipe(
            Effect.map((canonical) => [...new Set(canonical)]),
            Effect.flatMap((mentions) =>
              requireChannelMentionsResolve({
                command: { type: "channel.post.create" } as never,
                channel: { id: ChannelId.make(CHANNEL_ID), members: opts.members } as never,
                mentions: mentions as never,
              }),
            ),
            Effect.result,
          );
          if (verdict._tag === "Failure") {
            yield* Ref.update(deciderRejections, (r) => [
              ...r,
              String((verdict as { failure: { detail: string } }).failure.detail),
            ]);
            return yield* Effect.fail(
              new ChannelGateway.ChannelMentionUnresolvable({ handles: input.mentions }),
            );
          }
          return { postId: "post-new", createdAt: "2026-09-11T18:05:00.000Z" };
        }),
    }),
  );

  const toolkit = yield* CommsToolkit.pipe(
    Effect.provide(CommsToolkitHandlersLive.pipe(Layer.provide(gateway))),
  );

  const call = <Name extends keyof typeof CommsToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
    threadId: ThreadId = THREAD_ID,
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map(
        (chunk) => chunk.at(-1)!.result as Tool.Success<(typeof CommsToolkit.tools)[Name]>,
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(threadId)),
      Effect.provide(gateway),
    );

  return { call, created, channelLookups, deciderRejections };
});

/**
 * Membership as the DECIDER would store it, not as a fixture asserts it.
 *
 * The handles go in capitalised because that is the shape that broke this seam,
 * and come out of the decider's own canonicaliser. A fixture that names stored
 * handles directly is a fixture that can name a membership the aggregate
 * refuses - which is what the version of this file written against the previous
 * aggregate did, and it stayed green while asserting a state that could no
 * longer exist.
 */
const asStored = (raw: ReadonlyArray<ChannelGateway.ChannelMember>) =>
  Effect.forEach(raw, (member) =>
    requireCanonicalChannelMember({
      command: { type: "channel.create" } as never,
      member: member as never,
    }),
  ).pipe(
    Effect.map((members) => members as unknown as ReadonlyArray<ChannelGateway.ChannelMember>),
  );

const RAW_MEMBERS: ReadonlyArray<ChannelGateway.ChannelMember> = [
  { handle: "Boss1", memberKind: "thread", memberId: OTHER_THREAD_ID },
  { handle: "boss3", memberKind: "thread", memberId: THREAD_ID },
];

/** What `RAW_MEMBERS` becomes on the way in. Folded, so "Boss1" is stored "boss1". */
const MEMBERS: ReadonlyArray<ChannelGateway.ChannelMember> = [
  { handle: "boss1", memberKind: "thread", memberId: OTHER_THREAD_ID },
  { handle: "boss3", memberKind: "thread", memberId: THREAD_ID },
];

describe("comms toolkit against the real aggregate invariants", () => {
  it.effect("a handle comms_read_channel shows is a handle the decider resolves", () =>
    Effect.gen(function* () {
      // The membership the toolkit is handed is the one the decider produces
      // from the raw input, byte for byte. Asserted rather than assumed: every
      // other line here is about what the two sides do with these handles, and
      // it means nothing if the handles are not the ones that get stored.
      expect(yield* asStored(RAW_MEMBERS)).toEqual(MEMBERS);
      expect(
        (yield* requireChannelMembersUnique({
          command: { type: "channel.create" } as never,
          seated: [],
          adding: MEMBERS as never,
        }).pipe(Effect.result))._tag,
      ).toBe("Success");

      const seam = yield* makeSeam({
        channelName: "seniors",
        members: MEMBERS,
        memberThreadIds: [THREAD_ID, OTHER_THREAD_ID],
      });

      // What the agent is told it may mention...
      const read = yield* seam.call("comms_read_channel", { channel: "seniors" });
      expect(read.members).toEqual(["boss1", "boss3"]);

      // ...is accepted verbatim, and reaches the aggregate unchanged.
      for (const mention of read.members) {
        const result = yield* seam.call("comms_post", {
          channel: "seniors",
          body: "please review",
          mentions: [mention],
        });
        expect(result.mentioned).toEqual([mention]);
      }
      expect((yield* Ref.get(seam.created)).map((c) => c.mentions)).toEqual([["boss1"], ["boss3"]]);
      expect(yield* Ref.get(seam.deciderRejections)).toEqual([]);
    }),
  );

  it.effect("a mention the toolkit accepts is never one the aggregate rejects", () =>
    Effect.gen(function* () {
      const seam = yield* makeSeam({
        channelName: "seniors",
        members: MEMBERS,
        memberThreadIds: [THREAD_ID, OTHER_THREAD_ID],
      });
      // Sigil, whitespace AND case are the agent's to get wrong: all three are
      // normalised on the way in, by one rule both sides import. The previous
      // version of this test asserted the opposite for case, correctly, against
      // an aggregate that stored handles byte-exactly.
      const result = yield* seam.call("comms_post", {
        channel: "seniors",
        body: "over to you",
        mentions: ["@Boss1", " boss3 "],
      });
      expect(result.mentioned).toEqual(["boss1", "boss3"]);
      expect(yield* Ref.get(seam.deciderRejections)).toEqual([]);

      // A handle that resolves to nobody is refused BY THE TOOLKIT, with the
      // bad handle named, rather than accepted here and refused whole by the
      // aggregate - which is the failure this seam exists to keep out: the
      // aggregate rejects the POST, so one bad mention loses the message.
      const error = yield* seam
        .call("comms_post", { channel: "seniors", body: "x", mentions: ["boss2"] })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "CommsMemberNotFoundError", handles: ["boss2"] });
      expect(yield* Ref.get(seam.deciderRejections)).toEqual([]);
    }),
  );

  it.effect("collides two handles that differ only by a fold no ASCII rule would make", () =>
    Effect.gen(function* () {
      // ASCII case is pinned through the real command path in
      // decider.channels.test.ts ("collides two handles that differ only by
      // case"), so this takes the row nothing covers: U+212A KELVIN SIGN, which
      // toLowerCase() folds onto plain "k". Two handles that share no code
      // point are one mention key, and a uniqueness check that reasoned about
      // letter case rather than running the canonicaliser would admit both.
      const members = yield* Effect.forEach(["Kai", "kai"], (handle) =>
        requireCanonicalChannelMember({
          command: { type: "channel.create" } as never,
          member: { handle, memberKind: "human", memberId: `human-${handle}` } as never,
        }),
      );
      const verdict = yield* requireChannelMembersUnique({
        command: { type: "channel.create" } as never,
        seated: [],
        adding: members as never,
      }).pipe(Effect.result);
      expect(verdict._tag).toBe("Failure");
    }),
  );

  it.effect("distinct members never collapse into one mention key", () =>
    Effect.gen(function* () {
      // Members the aggregate keeps apart once canonical, which is now the only
      // kind there is: this roster is what the decider produced from the raw
      // spellings, so nothing here is a membership it would refuse.
      const members = yield* asStored([
        { handle: "Walt", memberKind: "human", memberId: "human-walt" },
        { handle: "walt-bot", memberKind: "thread", memberId: "thread-walt-bot" },
        { handle: "@Kai", memberKind: "human", memberId: "human-kai" },
        { handle: "  kai-bot  ", memberKind: "thread", memberId: "thread-kai-bot" },
        { handle: "boss3", memberKind: "thread", memberId: THREAD_ID },
      ]);
      expect(
        (yield* requireChannelMembersUnique({
          command: { type: "channel.create" } as never,
          seated: [],
          adding: members as never,
        }).pipe(Effect.result))._tag,
      ).toBe("Success");

      const seam = yield* makeSeam({
        channelName: "seniors",
        members,
        memberThreadIds: [THREAD_ID],
      });
      const read = yield* seam.call("comms_read_channel", { channel: "seniors" });
      // Five members, five distinguishable handles. Two pairs differ only after
      // a sigil and some whitespace come off, which is where a canonicaliser
      // running on the wrong side of the seam would lose one.
      expect(read.members).toEqual(["walt", "walt-bot", "kai", "kai-bot", "boss3"]);
      expect(new Set(read.members).size).toBe(members.length);

      // Each one routes to itself.
      for (const member of members) {
        expect(resolveMentions([member.handle], members)).toEqual({ handles: [member.handle] });
      }
    }),
  );

  it.effect("sees the two sides disagree on a row stored under an older rule", () =>
    Effect.gen(function* () {
      // THE OBSERVATION THIS FILE EXISTS FOR, and it was not possible until the
      // fake ran the decider's whole post path. A membership row written under
      // an older form of the rule is not canonical: the toolkit correctly emits
      // the STORED bytes, the decider canonicalises the mention, and the two no
      // longer meet - so the aggregate rejects the POST, whole, for one mention.
      // That is the PR #5 regression class, and with the old one-step fake it
      // reported Success.
      //
      // Not constructible through today's decider, and not a faked state: the
      // gateway reads a read model, and a read model can hold what the
      // aggregate would now refuse.
      const legacy: ReadonlyArray<ChannelGateway.ChannelMember> = [
        { handle: "Boss1", memberKind: "thread", memberId: OTHER_THREAD_ID },
        { handle: "boss3", memberKind: "thread", memberId: THREAD_ID },
      ];
      const seam = yield* makeSeam({
        channelName: "seniors",
        members: legacy,
        memberThreadIds: [THREAD_ID, OTHER_THREAD_ID],
      });

      // The toolkit does its job: it finds the member and emits what is stored.
      expect(resolveMentions(["boss1"], legacy)).toEqual({ handles: ["Boss1"] });

      // And the aggregate refuses it, which the agent sees as its whole post
      // failing on a handle comms_read_channel showed it.
      const error = yield* seam
        .call("comms_post", { channel: "seniors", body: "please review", mentions: ["boss1"] })
        .pipe(Effect.flip);
      // The agent is told its handle was not found - by the toolkit, which
      // DID find it. That is the shape of the original regression: the tool
      // that produced the handle reports it as unknown, because the gateway
      // maps the aggregate's refusal onto the same error.
      expect((error as { _tag: string })._tag).toBe("CommsMemberNotFoundError");
      const rejections = yield* Ref.get(seam.deciderRejections);
      expect(rejections).toHaveLength(1);
      // And the handle the decider names as unresolvable is the CANONICAL one,
      // which appears nowhere the agent could have read it: comms_read_channel
      // showed "Boss1", the toolkit emitted "Boss1", and the refusal is about
      // "boss1". Three spellings, one member, and no way for the agent to tell
      // from the error which of them to try next.
      expect(rejections[0]).toContain("boss1");
      expect(rejections[0]).not.toContain("Boss1");
    }),
  );

  it.effect("a non-member and a non-existent channel are one answer, byte for byte", () =>
    Effect.gen(function* () {
      // The channel exists; THREAD_ID is not in it.
      const seam = yield* makeSeam({
        channelName: "Private-Ops",
        members: [{ handle: "Boss1", memberKind: "thread", memberId: OTHER_THREAD_ID }],
        memberThreadIds: [OTHER_THREAD_ID],
      });

      const answer = (probe: string) =>
        seam
          .call("comms_post", { channel: probe, body: "let me in", mentions: ["Boss1", "ghost"] })
          .pipe(
            Effect.flip,
            Effect.map((error) => ({
              tag: (error as { _tag: string })._tag,
              echoed: (error as { channel?: string }).channel,
              message: (error as { message: string }).message,
            })),
          );

      // Three spellings of a channel that exists and excludes the caller...
      const excluded = yield* Effect.all(
        ["Private-Ops", "private-ops", "#PRIVATE-OPS"].map(answer),
      );
      // ...and two of one that does not exist at all.
      const missing = yield* Effect.all(["Private-Opz", "PRIVATE-OPZ"].map(answer));

      // Identical but for the name the caller itself supplied.
      for (const seen of excluded) {
        expect(seen).toEqual({
          tag: "CommsChannelNotFoundError",
          echoed: "private-ops",
          message: "No channel named 'private-ops' that you are a member of.",
        });
      }
      for (const seen of missing) {
        expect(seen).toEqual({
          tag: "CommsChannelNotFoundError",
          echoed: "private-opz",
          message: "No channel named 'private-opz' that you are a member of.",
        });
      }

      // Mentions are never evaluated for a channel the caller is not in, so no
      // membership fact escapes; membership is a parameter of the lookup, not a
      // separate guard that could be reordered away from it.
      expect(yield* Ref.get(seam.created)).toEqual([]);
      expect((yield* Ref.get(seam.channelLookups)).map(([name]) => name)).toEqual([
        "private-ops",
        "private-ops",
        "private-ops",
        "private-opz",
        "private-opz",
      ]);
    }),
  );

  it("what an error echoes is a function of the caller's own input, never of what is stored", () => {
    // Every echoed value in the two error paths is derived from the argument
    // alone, so an error cannot confirm a name or a handle the caller guessed.
    expect(toolkitCanonicalChannelName("#SECRET-PROJECT")).toBe("secret-project");
    expect(resolveMentions(["@GHOST", "Nobody", "@Boss1"], MEMBERS)).toEqual({
      unknown: ["ghost", "nobody"],
    });
  });
});
