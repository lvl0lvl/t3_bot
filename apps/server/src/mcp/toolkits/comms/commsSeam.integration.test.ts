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
 * WHAT IT NO LONGER SEES, which is worth knowing before trusting it. Its
 * membership is canonical now, so a toolkit that emitted the LOOKUP KEY instead
 * of the member's stored handle would emit the same bytes and every test here
 * would stay green. Verified by mutation. The rule survives only where the two
 * differ — a row stored before the aggregate canonicalised — and that lives in
 * handlers.test.ts, where six tests red on it.
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
  requireCanonicalChannelMember,
  requireChannelHandlesUnique,
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
  const channelLookups = yield* Ref.make<ReadonlyArray<readonly [string, string]>>([]);
  const deciderRejections = yield* Ref.make<ReadonlyArray<string>>([]);

  const gateway = Layer.succeed(
    ChannelGateway.ChannelGateway,
    ChannelGateway.ChannelGateway.of({
      getChannelForMember: (name, threadId) =>
        Ref.update(channelLookups, (seen) => [...seen, [name, threadId] as const]).pipe(
          Effect.as(
            name === canonicalChannelName(opts.channelName) &&
              opts.memberThreadIds.includes(threadId)
              ? Option.some<ChannelGateway.Channel>({
                  channelId: CHANNEL_ID,
                  name: canonicalChannelName(opts.channelName),
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
          const verdict = yield* requireChannelMentionsResolve({
            command: { type: "channel.post.create" } as never,
            channel: { id: ChannelId.make(CHANNEL_ID), members: opts.members } as never,
            mentions: input.mentions as never,
          }).pipe(Effect.result);
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
        (yield* requireChannelHandlesUnique({
          command: { type: "channel.create" } as never,
          members: MEMBERS as never,
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
      const verdict = yield* requireChannelHandlesUnique({
        command: { type: "channel.create" } as never,
        members: members as never,
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
        (yield* requireChannelHandlesUnique({
          command: { type: "channel.create" } as never,
          members: members as never,
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

  it("the toolkit's name rule and the decider's agree, input for input", () => {
    const cases = [
      "seniors",
      "#seniors",
      "Seniors",
      "#SENIORS",
      "  ##SENIORS  ",
      "# seniors",
      "###ops",
      "# #ops",
      "a#b",
    ];
    expect(cases.map((raw) => [raw, toolkitCanonicalChannelName(raw)])).toEqual(
      cases.map((raw) => [raw, canonicalChannelName(raw)]),
    );
  });

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
