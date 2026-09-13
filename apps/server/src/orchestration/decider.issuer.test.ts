import {
  ChannelId,
  ChannelMemberHandle,
  ChannelPostId,
  CommandId,
  CommandIssuer as CommandIssuerSchema,
  OrchestrationCommand,
  type CommandIssuer,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import {
  COLLIDING_HUMAN_ISSUER,
  COLLIDING_THREAD_ISSUER,
  collidingReadModel,
} from "./testing/collidingRoster.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const CHANNEL = ChannelId.make("channel-1");
const BOSS1 = ChannelMemberHandle.make("boss1");

const HUMAN: CommandIssuer = { memberKind: "human", memberId: "human-walt" };
const SYSTEM: CommandIssuer = { memberKind: "system", memberId: "checkpoint-reactor" };
const MEMBER_THREAD: CommandIssuer = { memberKind: "thread", memberId: "thread-boss1" };
const OUTSIDER_THREAD: CommandIssuer = { memberKind: "thread", memberId: "thread-stranger" };
// The seated human member. Its handle is NOT "walt": that one is added by
// "accepts a human member whose id is not any thread's", and seating it here
// too would make that test fail on handle uniqueness rather than on the guard
// it is about.
const OWNER = ChannelMemberHandle.make("owner");
const MEMBER_HUMAN: CommandIssuer = { memberKind: "human", memberId: "human-owner" };
// Same KIND as the member above and a member id the roster does not contain, so
// the refusal it triggers is about MEMBERSHIP and not about kind.
const OUTSIDER_HUMAN: CommandIssuer = { memberKind: "human", memberId: "human-stranger" };

/**
 * The threads a channel's members name.
 *
 * A `thread` member must resolve to a live thread, so a fixture whose members
 * name threads that do not exist is not a realistic read model — every channel
 * test had one until the shape invariant landed and refused them all. Minimal by
 * design: the invariant reads `id` and `deletedAt`, and the cast is what lets the
 * fixture say so instead of carrying thirty irrelevant fields.
 */
function threadsNamed(
  ids: ReadonlyArray<string>,
  options: { readonly deleted?: ReadonlyArray<string> } = {},
): OrchestrationReadModel["threads"] {
  return ids.map((id) => ({
    id,
    deletedAt: options.deleted?.includes(id) === true ? NOW : null,
  })) as unknown as OrchestrationReadModel["threads"];
}

const CHANNEL_THREAD_IDS = [
  "thread-boss1",
  "thread-pm",
  "thread-boss3",
  "thread-a",
  "thread-b",
  "thread-other",
  "thread-stranger",
  "thread-nobody",
  "thread-x",
  "thread-emoji",
  "thread-impostor",
];

function readModel(): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: threadsNamed(CHANNEL_THREAD_IDS),
    channels: [
      {
        id: CHANNEL,
        name: "seniors",
        members: [
          { handle: BOSS1, memberKind: "thread", memberId: "thread-boss1" },
          // A HUMAN member, seated because the browser path now reaches these
          // guards with a `human` issuer. Without one on the roster, no test in
          // this file puts a human on either side of
          // `requireChannelAuthorIsMember` — so its refusal was measured only
          // in the thread direction, which is the direction a browser cannot
          // take.
          { handle: OWNER, memberKind: "human", memberId: "human-owner" },
        ],
        archivedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    updatedAt: NOW,
  };
}

/** One probe per channel command, all valid apart from the issuer under test. */
function channelProbe(type: string) {
  switch (type) {
    case "channel.create":
      return {
        type,
        commandId: CommandId.make(`cmd-${type}`),
        channelId: ChannelId.make("channel-new"),
        name: "juniors",
        members: [{ handle: BOSS1, memberKind: "thread" as const, memberId: "thread-boss1" }],
        createdAt: NOW,
      };
    case "channel.meta.update":
      return {
        type,
        commandId: CommandId.make(`cmd-${type}`),
        channelId: CHANNEL,
        name: "renamed",
      };
    case "channel.archive":
    case "channel.unarchive":
      return { type, commandId: CommandId.make(`cmd-${type}`), channelId: CHANNEL };
    case "channel.member.add":
      return {
        type,
        commandId: CommandId.make(`cmd-${type}`),
        channelId: CHANNEL,
        member: {
          handle: ChannelMemberHandle.make("boss3"),
          memberKind: "thread" as const,
          memberId: "thread-boss3",
        },
      };
    case "channel.member.remove":
      return {
        type,
        commandId: CommandId.make(`cmd-${type}`),
        channelId: CHANNEL,
        handle: BOSS1,
      };
    case "channel.post.create":
      return {
        type,
        commandId: CommandId.make(`cmd-${type}`),
        channelId: CHANNEL,
        postId: ChannelPostId.make("post-1"),
        body: "hello",
        mentions: [],
        parentPostId: null,
        createdAt: NOW,
      };
    default:
      return undefined;
  }
}

/**
 * Every `channel.*` type in the command union, read off the schema.
 *
 * Derived rather than listed: a channel command added later is covered by these
 * tests automatically, so shipping one that skips the issuer checks fails here
 * instead of shipping unauthorized. A hand-written list would silently not
 * include it — which is exactly how this class of hole got in.
 */
function channelCommandTypes(): ReadonlyArray<string> {
  const groups: ReadonlyArray<{
    readonly members: ReadonlyArray<{
      readonly fields: { readonly type: { readonly literal: string } };
    }>;
  }> = OrchestrationCommand.members as never;
  const members = groups.flatMap((group) => group.members);
  const unreadable = members.filter((member) => typeof member.fields.type.literal !== "string");
  // A member the accessor cannot read is skipped in silence, and a channel
  // command that is never enumerated is never issuer-checked.
  expect(unreadable, "these union members did not yield a type literal").toEqual([]);
  return [
    ...new Set(
      members
        .map((member) => member.fields.type.literal)
        .filter((literal) => literal.startsWith("channel.")),
    ),
  ].sort();
}

it.layer(NodeServices.layer)("command issuer authorization", (it) => {
  /**
   * An OFF-UNION issuer kind, which is the only input that tells an allow-list
   * from a deny-list.
   *
   * The schema-literal test below asserts the union is still the three kinds. It
   * does NOT exercise a fourth, so both guards were unpinned: rewriting either as
   * `!== "thread"` or `=== "system"` left the entire suite green. The cast is the
   * point — it simulates the contract edit that adds a kind, which is the change
   * whose safety these guards exist to provide.
   */
  const RELAY = { memberKind: "relay", memberId: "relay-1" } as unknown as CommandIssuer;

  it.effect("refuses an issuer kind that is not in the union, on administration", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: channelProbe("channel.member.add") as never,
        readModel: readModel(),
        issuer: RELAY,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("cannot administer a channel");
        // Names the kind, so an operator reading the log knows what arrived.
        expect(error.detail).toContain("relay");
      }
    }),
  );

  it.effect("refuses an off-union issuer authoring EVEN WHEN it is seated", () =>
    Effect.gen(function* () {
      // Seating it is what makes this test discriminating. Unseated, the author
      // check refuses a relay issuer for a different reason — not a member — so
      // the test would pass under the deny-list mutation too and prove nothing.
      // Seated, a deny-list ACCEPTS the post; only an allow-list refuses it.
      const base = readModel();
      const seated = {
        ...base,
        channels: base.channels.map((channel) => ({
          ...channel,
          members: [
            ...channel.members,
            { handle: "relay", memberKind: "relay", memberId: "relay-1" },
          ],
        })),
      } as unknown as typeof base;
      const error = yield* decideOrchestrationCommand({
        command: channelProbe("channel.post.create") as never,
        readModel: seated,
        issuer: RELAY,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("cannot author a channel post");
        expect(error.detail).toContain("relay");
      }
    }),
  );

  it("pins the issuer kinds, so adding one cannot silently gain access", () => {
    // Both guards are allow-lists naming "human", "thread" and "system". A kind
    // added to CommandIssuer is refused by default rather than granted, but only
    // as long as somebody notices it needs a decision — this is that notice.
    const kinds = (
      CommandIssuerSchema.fields.memberKind as { readonly literals: ReadonlyArray<string> }
    ).literals;
    expect([...kinds].sort()).toEqual(["human", "system", "thread"]);
  });

  it("finds every channel command in the union", () => {
    // If this drops to zero the traversal broke and every test below turns
    // vacuous while still passing.
    const types = channelCommandTypes();
    expect(types.length, `found: ${types.join(", ")}`).toBe(7);
    expect(types).toContain("channel.post.create");
    expect(types).toContain("channel.member.add");
  });

  it.effect("refuses every channel command that arrives without an issuer", () =>
    Effect.gen(function* () {
      // Fail CLOSED. The issuer rides the decider's input, not the command, so
      // the compiler cannot force a call site to pass it — this is what stops a
      // forgotten issuer from meaning "unauthorized but allowed".
      //
      // THE REFUSAL HAS TO BE THE TYPED INVARIANT ERROR, not merely something going
      // wrong. Force this guard's presence check to take the issuer-present branch
      // and it succeeds with `undefined`, the next guard dereferences that, and all
      // seven commands come back as a DEFECT — which an `exit._tag === "Failure"`
      // check counts as a refusal, because `Failure` is true of a Die as well as a
      // Fail. That is what this test could not see.
      //
      // WHAT KILLS THAT MUTANT IS `Effect.flip`, NOT THE ASSERTIONS BELOW, and the
      // distinction is worth keeping straight because it decides what may be
      // changed here. A defect propagates out of the flip, so the test dies before
      // either `expect` runs — measured: delete both and the mutant still dies.
      // Going back to `Effect.exit` while keeping the assertions restores the hole
      // in full.
      //
      // Downstream a typed failure is CATCHABLE BY TAG and a defect is not:
      // `git/linkCreatedPullRequest.ts` catches this error by name. It is not the
      // difference between a refusal and a 500 on the HTTP door — `Effect.catch`
      // there maps the typed error to an internal error too, which is `t3_bot-nqf`.
      const refused: Array<string> = [];
      for (const type of channelCommandTypes()) {
        const command = channelProbe(type);
        expect(command, `no probe for ${type} — add one`).toBeDefined();
        if (command === undefined) continue;
        // `Effect.flip` yields the typed error and lets a defect through, so a
        // dereference crash fails this test instead of being counted here.
        //
        // THE MESSAGE, because the tag alone is not enough for one of the seven.
        // Six call this guard first in their branch, so nothing else can refuse
        // them; `channel.post.create` has `requireChannel` ahead of it, so against
        // an absent channel a DIFFERENT invariant refuses first and satisfies the
        // tag while the issuer check is gone. Measured on that input: with the
        // message assertion this test reds, with only the tag it passes.
        const error = yield* decideOrchestrationCommand({
          command: command as never,
          readModel: readModel(),
        }).pipe(Effect.flip);
        expect(error._tag, type).toBe("OrchestrationCommandInvariantError");
        if (error._tag === "OrchestrationCommandInvariantError") {
          expect(error.detail, type).toContain(
            "arrived without an issuer and cannot be authorized",
          );
        }
        refused.push(type);
      }
      // THE ENUMERATION, not the refusal — which is a demotion worth recording.
      // The push above is unconditional now, so every path that could skip it
      // throws first and reaching this line implies it passes. Before this test
      // asserted the typed error it was the load-bearing assertion; it is not any
      // more, and a reader trusting it to catch a command that does not refuse
      // would be wrong. What it still does is prove the loop ran over all seven.
      expect(refused).toEqual(channelCommandTypes());
    }),
  );

  it.effect("refuses a thread issuer on every administration command", () =>
    Effect.gen(function* () {
      // An agent that could add itself would be granting itself post and read
      // rights on any channel whose id it can name; one that could remove a
      // peer would evict it from the wake set silently.
      const administration = channelCommandTypes().filter((type) => type !== "channel.post.create");
      expect(administration.length).toBe(6);
      for (const type of administration) {
        const command = channelProbe(type);
        if (command === undefined) continue;
        const error = yield* decideOrchestrationCommand({
          command: command as never,
          readModel: readModel(),
          issuer: MEMBER_THREAD,
        }).pipe(Effect.flip);
        expect(error._tag, type).toBe("OrchestrationCommandInvariantError");
        if (error._tag === "OrchestrationCommandInvariantError") {
          expect(error.detail, type).toContain("cannot administer a channel");
        }
      }
    }),
  );

  it.effect("accepts a human and a system issuer on administration", () =>
    Effect.gen(function* () {
      // The mirror of the test above, and the ONLY thing measuring this guard's
      // admit side: widening requireIssuerCanAdminister to human-only reds this
      // test and nothing else in 608. Deleting it leaves the refusal side green
      // while channel administration silently stops working for reactors.
      //
      // Every mutation sweep until now made guards INERT, which only ever tests
      // what a guard EXCLUDES; a guard that excludes too much survives that
      // untouched. This is the other axis.
      for (const issuer of [HUMAN, SYSTEM]) {
        const decided = yield* decideOrchestrationCommand({
          command: channelProbe("channel.member.add") as never,
          readModel: readModel(),
          issuer,
        });
        const events = Array.isArray(decided) ? decided : [decided];
        expect(events[0]?.type, issuer.memberKind).toBe("channel.member-added");
      }
    }),
  );

  it.effect("stamps the author from the issuer, not from anything the caller sent", () =>
    Effect.gen(function* () {
      // The command has no author field at all now, so the strongest statement
      // available is that a spoof attempt cannot even be expressed — and that
      // what lands is the issuer's identity.
      const spoofed = {
        ...(channelProbe("channel.post.create") as Record<string, unknown>),
        authorRef: { memberKind: "human", memberId: "human-walt" },
        authorHandle: "walt",
      };
      const decided = yield* decideOrchestrationCommand({
        command: spoofed as never,
        readModel: readModel(),
        issuer: MEMBER_THREAD,
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("channel.post-created");
      if (events[0]?.type === "channel.post-created") {
        expect(events[0].payload.authorRef).toEqual(MEMBER_THREAD);
        expect(events[0].payload.authorHandle).toBe(BOSS1);
      }
    }),
  );

  it.effect("refuses a post from a thread that is not a member", () =>
    Effect.gen(function* () {
      // This is the check the old shape never made: it asked whether the author
      // was SOME member, never whether it was the CALLER.
      const error = yield* decideOrchestrationCommand({
        command: channelProbe("channel.post.create") as never,
        readModel: readModel(),
        issuer: OUTSIDER_THREAD,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("Author is not a member");
      }
    }),
  );

  it.effect("a human member authors, and the event names that member", () =>
    Effect.gen(function* () {
      // The admitting half in the HUMAN direction, which is the only direction
      // a browser can take: the wire admits `channel.post.create` and the
      // WebSocket layer stamps a `human` issuer on it.
      const decided = yield* decideOrchestrationCommand({
        command: channelProbe("channel.post.create") as never,
        readModel: readModel(),
        issuer: MEMBER_HUMAN,
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("channel.post-created");
      if (events[0]?.type === "channel.post-created") {
        // The AUTHOR, not just success. `authorHandle` is taken from the
        // membership row the lookup returns, so a lookup that returned the
        // wrong row would attribute a human's post to an agent.
        expect(events[0].payload.authorRef).toEqual(MEMBER_HUMAN);
        expect(events[0].payload.authorHandle).toBe(OWNER);
      }
    }),
  );

  it.effect("refuses a post from a human that is not a member", () =>
    Effect.gen(function* () {
      // The refusing half in the same direction. Before the wire admitted
      // `channel.post.create`, no human issuer could reach this guard and
      // measuring it here would have been measuring an unreachable path; after
      // it, every browser post takes it. Measured: admitting any human
      // unconditionally left the whole suite green before this test existed.
      const error = yield* decideOrchestrationCommand({
        command: channelProbe("channel.post.create") as never,
        readModel: readModel(),
        issuer: OUTSIDER_HUMAN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("Author is not a member");
      }
    }),
  );

  it.effect("refuses a system issuer as a post author", () =>
    Effect.gen(function* () {
      // A reactor has no handle, so it has nothing to appear as in a channel.
      // It may administer, not speak.
      const error = yield* decideOrchestrationCommand({
        command: channelProbe("channel.post.create") as never,
        readModel: readModel(),
        issuer: SYSTEM,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("cannot author");
      }
    }),
  );

  it.effect("refuses a post to an archived channel", () =>
    Effect.gen(function* () {
      // Archived is readable, not postable. A retired channel that still accepts
      // posts wakes its members from something nobody is watching.
      const archived = readModel();
      const error = yield* decideOrchestrationCommand({
        command: channelProbe("channel.post.create") as never,
        readModel: {
          ...archived,
          channels: archived.channels.map((channel) => ({ ...channel, archivedAt: NOW })),
        },
        issuer: MEMBER_THREAD,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("is archived and cannot handle command");
        // The tag the live gateway maps to `ChannelArchived`; the prose above
        // is a log line it must not read.
        expect(error.reason).toEqual({ _tag: "channel-archived" });
      }
    }),
  );

  it.effect("tells an outsider nothing about an archived channel existing", () =>
    Effect.gen(function* () {
      // "Archived" reveals the channel EXISTS. The member check runs first, so a
      // non-member gets the membership answer and learns nothing — swapping the
      // two guards is a one-line change that turns this into an existence
      // oracle, which is why it is pinned rather than left to the ordering.
      const archived = readModel();
      const error = yield* decideOrchestrationCommand({
        command: channelProbe("channel.post.create") as never,
        readModel: {
          ...archived,
          channels: archived.channels.map((channel) => ({ ...channel, archivedAt: NOW })),
        },
        issuer: OUTSIDER_THREAD,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("Author is not a member");
        expect(error.detail).not.toContain("archived");
      }
    }),
  );

  it.effect("still allows unarchiving an archived channel", () =>
    Effect.gen(function* () {
      // The way out. Refusing posts must not also refuse the command that makes
      // the channel postable again — a one-way door is a bug.
      const archived = readModel();
      const decided = yield* decideOrchestrationCommand({
        command: channelProbe("channel.unarchive") as never,
        readModel: {
          ...archived,
          channels: archived.channels.map((channel) => ({ ...channel, archivedAt: NOW })),
        },
        issuer: HUMAN,
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("channel.unarchived");
    }),
  );

  it.effect("refuses a human member carrying a real thread's id", () =>
    Effect.gen(function* () {
      // The impersonation route. memberKind decides what a member IS — a thread
      // that can be woken, or a human who cannot — and nothing checked that the
      // id matched the claim. A human member carrying a real thread's id sits in
      // the roster beside the thread it names, and anything resolving a member to
      // a thread by id reaches the real one.
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "channel.member.add",
          commandId: CommandId.make("cmd-add-impostor"),
          channelId: CHANNEL,
          member: {
            handle: "walt",
            memberKind: "human",
            memberId: "thread-boss1",
          },
        } as never,
        readModel: readModel(),
        issuer: HUMAN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("is a thread id");
      }
    }),
  );

  it.effect("refuses an impostor member on the CREATE path too", () =>
    Effect.gen(function* () {
      // Two call sites, and only member.add was covered: deleting the check from
      // channel.create passed all 604 tests. A guard wired twice and tested once
      // is a guard on one path.
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "channel.create",
          commandId: CommandId.make("cmd-create-impostor"),
          channelId: ChannelId.make("channel-impostor"),
          name: "juniors",
          members: [{ handle: "walt", memberKind: "human", memberId: "thread-boss1" }],
          createdAt: NOW,
        } as never,
        readModel: readModel(),
        issuer: HUMAN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("is a thread id");
      }
    }),
  );

  it.effect("refuses a thread member naming a thread that does not exist", () =>
    Effect.gen(function* () {
      // The other direction: a member that claims to be wakeable and is not.
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "channel.member.add",
          commandId: CommandId.make("cmd-add-phantom"),
          channelId: CHANNEL,
          member: {
            handle: "phantom",
            memberKind: "thread",
            memberId: "thread-does-not-exist",
          },
        } as never,
        readModel: readModel(),
        issuer: HUMAN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("is not a thread");
      }
    }),
  );

  it.effect("refuses a thread member naming a DELETED thread", () =>
    Effect.gen(function* () {
      // Deletion is soft, so the id still resolves. A member pointing at a deleted
      // thread is a roster entry no mention can ever wake — it looks like a
      // participant and is not one, which is worse than refusing it.
      const base = readModel();
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "channel.member.add",
          commandId: CommandId.make("cmd-add-deleted"),
          channelId: CHANNEL,
          member: {
            handle: "ghost",
            memberKind: "thread",
            memberId: "thread-x",
          },
        } as never,
        readModel: {
          ...base,
          threads: threadsNamed(CHANNEL_THREAD_IDS, { deleted: ["thread-x"] }),
        },
        issuer: HUMAN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("can never be woken");
      }
    }),
  );

  it.effect("accepts a human member whose id is not any thread's", () =>
    Effect.gen(function* () {
      // The mirror, and the ONLY thing measuring this guard's admit side:
      // widening requireChannelMemberShape to refuse every human member reds
      // this test and nothing else in 608. Deleting it leaves the three refusal
      // tests above green while humans can no longer join a channel.
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "channel.member.add",
          commandId: CommandId.make("cmd-add-human"),
          channelId: CHANNEL,
          member: { handle: "walt", memberKind: "human", memberId: "human-walt" },
        } as never,
        readModel: readModel(),
        issuer: HUMAN,
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("channel.member-added");
    }),
  );

  it.effect("refuses a handle carrying an invisible character", () =>
    Effect.gen(function* () {
      // "Non-empty after trim" admitted these: String.trim removes no control or
      // format character, so a handle of one zero-width space was storable, and
      // an invisible-prefixed "boss1" rendered exactly like the real member.
      const invisible: ReadonlyArray<
        readonly [label: string, handle: string, expectedCodePoint: string]
      > = [
        ["trailing U+200B", "boss1\u200B", "U+200B"],
        ["leading U+200B", "\u200Bboss1", "U+200B"],
        ["trailing NUL", "boss1\u0000", "U+0000"],
        // \p{C} alone missed the Hangul filler: invisible, and it made a second
        // member render identically to the first.
        ["hangul filler", "boss1\u3164", "U+3164"],
        ["zero width joiner", "boss1\u200D", "U+200D"],
      ];
      for (const [label, handle, expectedCodePoint] of invisible) {
        const error = yield* decideOrchestrationCommand({
          command: {
            type: "channel.member.add",
            commandId: CommandId.make("cmd-add-invisible"),
            channelId: CHANNEL,
            member: { handle, memberKind: "thread", memberId: "thread-x" },
          } as never,
          readModel: readModel(),
          issuer: HUMAN,
        }).pipe(Effect.flip);
        expect(error._tag, label).toBe("OrchestrationCommandInvariantError");
        if (error._tag === "OrchestrationCommandInvariantError") {
          // NOT a disjunction. Every one of these rows takes the invisible-character
          // branch, so `/no canonical form|cannot appear.../` had a dead half and
          // could not tell the two handle guards apart: collapsing both into one
          // message passed the whole suite. The code point is asserted here too,
          // because it was only ever pinned on the NAME path.
          expect(error.detail, label).toContain("cannot appear in a stored handle");
          expect(error.detail, label).toContain(expectedCodePoint);
        }
      }
    }),
  );

  it.effect("closes the variation-selector spoof by collision, not by refusal", () =>
    Effect.gen(function* () {
      // Refusing variation selectors was a regression I introduced: U+FE0F is how
      // emoji presentation is requested, so "❤️" stopped being a storable handle
      // while "🔥" still was. Stripping them keeps emoji handles working AND
      // closes the spoof better — "boss1" + U+FE0F canonicalises to "boss1" and
      // collides with the real member, so uniqueness refuses it rather than two
      // identical-looking members both storing.
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "channel.member.add",
          commandId: CommandId.make("cmd-add-vs"),
          channelId: CHANNEL,
          member: { handle: "boss1\uFE0F", memberKind: "thread", memberId: "thread-impostor" },
        } as never,
        readModel: readModel(),
        issuer: HUMAN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        // The COLLISION message, not the invisible-character one. If this ever
        // says "cannot appear in a stored handle" again, emoji handles are broken.
        expect(error.detail).toContain("is used twice");
      }
    }),
  );

  it.effect("keeps an emoji handle storable", () =>
    Effect.gen(function* () {
      // The regression this is here to stop coming back. U+2764 U+FE0F must
      // store, as U+2764.
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "channel.member.add",
          commandId: CommandId.make("cmd-add-emoji"),
          channelId: CHANNEL,
          member: { handle: "\u2764\uFE0F", memberKind: "thread", memberId: "thread-emoji" },
        } as never,
        readModel: readModel(),
        issuer: HUMAN,
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("channel.member-added");
      if (events[0]?.type === "channel.member-added") {
        expect(events[0].payload.member.handle).toBe("\u2764");
      }
    }),
  );

  it.effect("refuses a channel name carrying an escape sequence", () =>
    Effect.gen(function* () {
      // A stored name is echoed to agent and CLI output, so a name carrying a
      // screen-clear sequence is a terminal write rather than a label.
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "channel.create",
          commandId: CommandId.make("cmd-create-ansi"),
          channelId: ChannelId.make("channel-ansi"),
          name: "#\u001B[2J\u001B[1;1Hseniors",
          members: [{ handle: BOSS1, memberKind: "thread", memberId: "thread-boss1" }],
          createdAt: NOW,
        } as never,
        readModel: readModel(),
        issuer: HUMAN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("cannot appear in a stored name");
        // Names the code point so an operator can act on it.
        expect(error.detail).toContain("U+001B");
      }
    }),
  );

  it.effect("keeps one member's mentions to one entry however they are spelled", () =>
    Effect.gen(function* () {
      // Folding made distinct spellings one handle, so three spellings of one
      // member resolved to three identical persisted mentions — the same member
      // woken three times for one post. Before folding, two of the three did
      // not resolve at all and the post was refused.
      const decided = yield* decideOrchestrationCommand({
        command: {
          ...(channelProbe("channel.post.create") as Record<string, unknown>),
          mentions: ["@Boss1", "boss1", "@@BOSS1"],
        } as never,
        readModel: readModel(),
        issuer: MEMBER_THREAD,
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("channel.post-created");
      if (events[0]?.type === "channel.post-created") {
        expect(events[0].payload.mentions).toEqual([BOSS1]);
      }
    }),
  );

  it.effect("does not move an archived channel's roster", () =>
    Effect.gen(function* () {
      // Adding a member to a channel nobody can post to, or removing one from a
      // channel nobody is reading, are changes with no observable effect.
      const base = readModel();
      const archived = {
        ...base,
        channels: base.channels.map((channel) => ({ ...channel, archivedAt: NOW })),
      };
      for (const type of ["channel.member.add", "channel.member.remove"]) {
        const error = yield* decideOrchestrationCommand({
          command: channelProbe(type) as never,
          readModel: archived,
          issuer: HUMAN,
        }).pipe(Effect.flip);
        expect(error._tag, type).toBe("OrchestrationCommandInvariantError");
        if (error._tag === "OrchestrationCommandInvariantError") {
          expect(error.detail, type).toContain("is archived and cannot handle command");
        }
      }
    }),
  );

  it.effect("refuses to re-archive, so the retirement timestamp survives", () =>
    Effect.gen(function* () {
      // Re-archiving overwrote archivedAt, so an idempotent-looking retry
      // destroyed the answer to "when was this retired".
      const base = readModel();
      const archived = {
        ...base,
        channels: base.channels.map((channel) => ({ ...channel, archivedAt: NOW })),
      };
      const error = yield* decideOrchestrationCommand({
        command: channelProbe("channel.archive") as never,
        readModel: archived,
        issuer: HUMAN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("is archived and cannot handle command");
      }
    }),
  );

  it.effect("refuses to unarchive a channel that is not archived", () =>
    Effect.gen(function* () {
      // The mirror. Without it an unarchive of a live channel emitted a no-op
      // event that a projector had to absorb.
      const error = yield* decideOrchestrationCommand({
        command: channelProbe("channel.unarchive") as never,
        readModel: readModel(),
        issuer: HUMAN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("is not archived");
      }
    }),
  );

  it.effect("still renames an archived channel, which is how its name is freed", () =>
    Effect.gen(function* () {
      // Deliberately NOT blocked: channels have no delete, so a rename is the
      // only way to free a name an archived channel's UNIQUE index still holds.
      const base = readModel();
      const archived = {
        ...base,
        channels: base.channels.map((channel) => ({ ...channel, archivedAt: NOW })),
      };
      const decided = yield* decideOrchestrationCommand({
        command: channelProbe("channel.meta.update") as never,
        readModel: archived,
        issuer: HUMAN,
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("channel.meta-updated");
    }),
  );
  it.effect(
    "resolves the author by KIND as well as id, so a colliding thread cannot post as a human",
    () =>
      Effect.gen(function* () {
        // THE GUARD UNDER TEST is the `memberKind` clause of `requireChannelAuthorIsMember`.
        // `t3_bot-ami`, found by the guard sweep: dropping it left every test in this
        // directory green, because no fixture that reached the author lookup held a
        // colliding pair — the two colliding rosters then in the tree were spent on other
        // guards (the removal event's ref, the wake budget) and neither drove a post
        // through the lookup.
        //
        // THE FIXTURE THAT SEPARATES THE IMPLEMENTATIONS is one channel holding two members
        // with the same `memberId` and different `memberKind`, with the WRONG one first:
        // `find` returns the first match, so a fixture with the right member first passes
        // under both and measures nothing. This test takes thread-first and posts as the
        // HUMAN; the test below takes human-first and posts as the THREAD.
        //
        // HOW SUCH A ROSTER ARRIVES. Thread-first was never command-producible:
        // `requireChannelMemberShape` refuses a human member whose id names a thread that
        // exists. Human-first was — seat the human, create the thread, add the thread
        // member — until `t3_bot-7iw` refused the `thread.create` (`requireThreadIdIsNoHuman`).
        // Both orderings now arrive by replay of rows written before those guards;
        // `./testing/collidingRoster.ts`'s header carries that history once. So the fixture
        // is a read model rather than a command sequence, and this guard is the check on
        // rows the aggregate no longer produces but a database may hold.
        //
        // The two fixtures above spend their collision proving the SHAPE guard (both assert
        // "is a thread id"), so neither can prove this one.
        // THE SHARED ROSTER (`./testing/collidingRoster.ts`), in the order this
        // test needs: thread FIRST, the shape only replay produces. The file's own
        // threads ride along so every other guard the probe crosses is satisfied.
        const colliding = collidingReadModel({
          now: NOW,
          channelId: CHANNEL,
          channelName: "seniors",
          humanHandle: OWNER,
          threadHandle: BOSS1,
          first: "thread",
          extra: { threads: threadsNamed(CHANNEL_THREAD_IDS) },
        });

        // THE ORDER IS THE MEASUREMENT, so it is asserted rather than left to the comment
        // above. `find` returns the first match, so the WRONG member has to be first:
        // reversed, this test passes under a memberId-only lookup too and measures nothing.
        // Measured by the review lane — reversing these two rows and applying the id-only
        // mutant left all 685 tests green, with the guard broken.
        //
        // Asserting a fixture is normally a smell. This fixture's order IS the
        // discriminating input, so pinning it pins the test's power, not the
        // implementation's.
        expect(colliding.channels[0]?.members[0]).toMatchObject({
          handle: BOSS1,
          memberKind: "thread",
        });

        const decided = yield* decideOrchestrationCommand({
          command: channelProbe("channel.post.create") as never,
          readModel: colliding,
          // The seated HUMAN, whose id the thread member shares.
          issuer: COLLIDING_HUMAN_ISSUER,
        });
        const events = Array.isArray(decided) ? decided : [decided];
        const event = events[0];
        expect(event?.type).toBe("channel.post-created");

        // THE AUTHOR HANDLE IS THE IMPERSONATION. It is taken from the row the lookup returned,
        // so a memberId-only lookup finds the thread member first and the post is stored as
        // written by `boss1` — a human posting under an agent's name, in the channel where the
        // agents read their instructions. Asserting the handle rather than the returned member
        // is what makes this about the consequence rather than about the function.
        expect(
          (event as { readonly payload?: { readonly authorHandle?: string } })?.payload
            ?.authorHandle,
        ).toBe(OWNER);
      }),
  );
  it.effect(
    "resolves a THREAD author past a human row sharing its id, which was the command-produced ordering",
    () =>
      Effect.gen(function* () {
        // THE ORDERING COMMANDS PRODUCED UNTIL `t3_bot-7iw`, and the mirror of the test above.
        // `requireChannelMemberShape` refuses a human member whose memberId names an EXISTING
        // thread, so by commands the human was necessarily added FIRST and the thread of that
        // name created after (`t3_bot-46h` criterion 4, answered by PR #24). Since 7iw that
        // `thread.create` is refused and this roster, like the one above, arrives by replay
        // only. It is [human/X, thread/X] — the reverse of the fixture above.
        //
        // Under a memberId-only lookup this is the impersonation that runs the other way: an
        // AGENT's post is found against the human row and stored under a human's handle. In the
        // channel where agents read their instructions, a post that appears to come from Walt is
        // the worse direction of the two.
        // THE SHARED ROSTER, human FIRST: the order the aggregate reached before
        // `t3_bot-7iw`, and the order that makes the WRONG row first for a thread author.
        const colliding = collidingReadModel({
          now: NOW,
          channelId: CHANNEL,
          channelName: "seniors",
          humanHandle: OWNER,
          threadHandle: BOSS1,
          first: "human",
          extra: { threads: threadsNamed(CHANNEL_THREAD_IDS) },
        });

        // The order is the measurement here too, mirrored.
        expect(colliding.channels[0]?.members[0]).toMatchObject({
          handle: OWNER,
          memberKind: "human",
        });

        const decided = yield* decideOrchestrationCommand({
          command: channelProbe("channel.post.create") as never,
          readModel: colliding,
          // The THREAD, whose id the human member shares.
          issuer: COLLIDING_THREAD_ISSUER,
        });
        const events = Array.isArray(decided) ? decided : [decided];
        const event = events[0];
        expect(event?.type).toBe("channel.post-created");
        expect(
          (event as { readonly payload?: { readonly authorHandle?: string } })?.payload
            ?.authorHandle,
        ).toBe(BOSS1);
      }),
  );
});
