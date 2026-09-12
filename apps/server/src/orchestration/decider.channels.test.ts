import {
  ChannelId,
  ChannelMemberHandle,
  ChannelPostId,
  CommandId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const CHANNEL = ChannelId.make("channel-1");
const BOSS1 = ChannelMemberHandle.make("boss1");
const PM = ChannelMemberHandle.make("pm");

/**
 * The engine stamps the issuer from the caller's credential; the decider never
 * takes it from the command. `pm` is a seeded member, so it can author. `walt`
 * is a human who is NOT a member: humans administer, members speak, and the two
 * are separate powers.
 */
const PM_ISSUER = { memberKind: "thread", memberId: "thread-pm" } as const;
const ADMIN = { memberKind: "human", memberId: "human-walt" } as const;
const STRANGER = { memberKind: "thread", memberId: "thread-stranger" } as const;

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

/** A #seniors-shaped channel: one thread member and one human. */
function makeReadModel(
  members: ReadonlyArray<{ handle: string; memberKind: "thread" | "human"; memberId: string }> = [
    { handle: "boss1", memberKind: "thread", memberId: "thread-boss1" },
    { handle: "pm", memberKind: "thread", memberId: "thread-pm" },
  ],
): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: threadsNamed(CHANNEL_THREAD_IDS),
    channels: [
      {
        id: CHANNEL,
        name: "seniors",
        members: members.map((member) => ({
          handle: ChannelMemberHandle.make(member.handle),
          memberKind: member.memberKind,
          memberId: member.memberId,
        })),
        archivedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    updatedAt: NOW,
  };
}

function postCommand(overrides: { readonly mentions?: ReadonlyArray<string> }) {
  return {
    type: "channel.post.create",
    commandId: CommandId.make("cmd-post-1"),
    channelId: CHANNEL,
    postId: ChannelPostId.make("post-1"),
    // No author field: the command cannot name who it is from.
    body: "what is 2+2",
    mentions: (overrides.mentions ?? ["boss1"]).map((handle) => ChannelMemberHandle.make(handle)),
    parentPostId: null,
    createdAt: NOW,
  } as const;
}

it.layer(NodeServices.layer)("channel decider", (it) => {
  it.effect("resolves authorHandle from membership onto the event", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: postCommand({}),
        readModel: makeReadModel(),
        issuer: PM_ISSUER,
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("channel.post-created");
      if (events[0]?.type === "channel.post-created") {
        // The reactor reads one event and must know who wrote it without a join.
        expect(events[0].payload.authorHandle).toBe(PM);
        expect(events[0].payload.mentions).toEqual([BOSS1]);
      }
    }),
  );

  it.effect("rejects a post whose author is not a member", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: postCommand({}),
        readModel: makeReadModel(),
        issuer: STRANGER,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      // Pins THIS invariant: without it another guard firing first would
      // satisfy the _tag and the test would survive deleting the one it names.
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("Author is not a member");
      }
    }),
  );

  it.effect("a non-member learns nothing about who is in the channel", () =>
    Effect.gen(function* () {
      // The mention error names the handles that did NOT resolve, which tells
      // the reader which ones DID. That is only safe because the author check
      // runs first, so a non-member never reaches it.
      //
      // This pins the RESOLUTION half only. Both handles here canonicalise
      // cleanly, so moving canonicalisation ahead of the author check does not
      // change this error — the test below is the one that pins the ordering.
      const error = yield* decideOrchestrationCommand({
        command: postCommand({ mentions: ["boss1", "nobody"] }),
        readModel: makeReadModel(),
        issuer: STRANGER,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("Author is not a member");
        expect(error.detail).not.toContain("nobody");
        expect(error.detail).not.toContain("boss1");
      }
    }),
  );

  it.effect("canonicalises mentions only after the author check", () =>
    Effect.gen(function* () {
      // The ordering control, pinned. Canonicalising a mention can itself FAIL
      // — "@" is a schema-valid handle with no canonical form — so a guard that
      // runs before the author check answers a non-member with a different
      // error than a member gets, which is a membership oracle.
      //
      // Only a mention that cannot be canonicalised can tell the two orders
      // apart. The test above uses handles that canonicalise cleanly, so it
      // passes under either order; this one goes red the moment the guards swap.
      const error = yield* decideOrchestrationCommand({
        command: postCommand({ mentions: ["@"] }),
        readModel: makeReadModel(),
        issuer: STRANGER,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("Author is not a member");
        expect(error.detail).not.toContain("no canonical form");
      }
    }),
  );

  it.effect("rejects the whole post when any mention does not resolve", () =>
    Effect.gen(function* () {
      // One good handle and one bad one: the post must not land with the good
      // half applied, because a dropped mention wakes nobody while looking sent.
      const error = yield* decideOrchestrationCommand({
        command: postCommand({ mentions: ["boss1", "nobody"] }),
        readModel: makeReadModel(),
        issuer: PM_ISSUER,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      // Pins THIS invariant: without it another guard firing first would
      // satisfy the _tag and the test would survive deleting the one it names.
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("Mentions do not resolve");
      }
    }),
  );

  it.effect("rejects a post to a channel that does not exist", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: postCommand({}),
        readModel: { ...makeReadModel(), channels: [] },
        issuer: PM_ISSUER,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      // Pins THIS invariant: without it another guard firing first would
      // satisfy the _tag and the test would survive deleting the one it names.
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("does not exist");
      }
    }),
  );

  it.effect("rejects creating a channel whose handles collide", () =>
    Effect.gen(function* () {
      // Handle is the mention key, so a duplicate makes "@boss1" ambiguous.
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "channel.create",
          commandId: CommandId.make("cmd-create-1"),
          channelId: ChannelId.make("channel-2"),
          name: "project",
          members: [
            { handle: BOSS1, memberKind: "thread", memberId: "thread-a" },
            { handle: BOSS1, memberKind: "thread", memberId: "thread-b" },
          ],
          createdAt: NOW,
        },
        readModel: makeReadModel(),
        issuer: ADMIN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      // Pins THIS invariant: without it another guard firing first would
      // satisfy the _tag and the test would survive deleting the one it names.
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("is used twice");
      }
    }),
  );

  it.effect("rejects adding a member whose handle is already taken", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "channel.member.add",
          commandId: CommandId.make("cmd-add-1"),
          channelId: CHANNEL,
          member: { handle: BOSS1, memberKind: "thread", memberId: "thread-other" },
        },
        readModel: makeReadModel(),
        issuer: ADMIN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      // Pins THIS invariant: without it another guard firing first would
      // satisfy the _tag and the test would survive deleting the one it names.
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("is used twice");
      }
    }),
  );

  it.effect("puts the removed member's ref on the event, with its KIND", () =>
    Effect.gen(function* () {
      // THE DECIDER IS THE ONLY PLACE THIS REF CAN COME FROM. Once
      // `channel.member-removed` is applied the member is gone from the
      // projection, so the websocket cannot look up who left — which is why it
      // used to tell every connected client that a channel it cannot see exists
      // (`t3_bot-7br`). The row is already in hand here; the event just has to
      // carry it.
      //
      // WITHOUT THIS TEST THE DECIDER'S HALF IS UNPINNED, and it was: the
      // socket-side tests build their own event fixtures with the ref written
      // in by hand, so deleting these two payload fields left every one of them
      // green. Measured, not assumed.
      //
      // A COLLIDING FIXTURE, because `memberId` alone cannot carry the answer:
      // the thread member and the human member below share one id and differ
      // only in kind, so an event that dropped `memberKind` would name a member
      // the socket cannot tell from the operator. That is `t3_bot-46h`, and it
      // is the same collision the mention-wake reactor keeps its own kind check
      // for.
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "channel.member.remove",
          commandId: CommandId.make("cmd-remove-ref"),
          channelId: CHANNEL,
          handle: ChannelMemberHandle.make("twin"),
        },
        readModel: makeReadModel([
          { handle: "walt", memberKind: "human", memberId: "human-walt" },
          { handle: "twin", memberKind: "thread", memberId: "thread-pm" },
        ]),
        issuer: ADMIN,
      });

      const event = Array.isArray(decided) ? decided[0] : decided;
      expect(event?.type).toBe("channel.member-removed");
      if (event?.type === "channel.member-removed") {
        // BOTH FIELDS. Asserting the id alone passes against an event that
        // hardcodes the wrong kind, which is the whole distinction the socket
        // gate turns on.
        expect(event.payload.removedMember?.memberKind).toBe("thread");
        expect(event.payload.removedMember?.memberId).toBe("thread-pm");
        // And the handle stays: it is the projector's key, unique within a
        // channel in a way `memberId` is not, and what the client renders.
        expect(event.payload.handle).toBe("twin");
      }
    }),
  );

  it.effect("rejects removing a handle that is not a member", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "channel.member.remove",
          commandId: CommandId.make("cmd-remove-1"),
          channelId: CHANNEL,
          handle: ChannelMemberHandle.make("nobody"),
        },
        readModel: makeReadModel(),
        issuer: ADMIN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      // Pins THIS invariant: without it another guard firing first would
      // satisfy the _tag and the test would survive deleting the one it names.
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("is not a member of channel");
      }
    }),
  );

  // The server holds two independent command-to-aggregate mappings: the
  // engine's routing switch and these per-event literals. Receipt scope is
  // correct only while they agree, and nothing in the type system relates
  // them — a channel command stamped "thread" here would make a legitimate
  // retry of an already-succeeded command fail as a conflict. This pins the
  // decider's half for every channel command.
  it.effect("stamps the channel aggregate on every channel command", () =>
    Effect.gen(function* () {
      const commands = [
        {
          type: "channel.meta.update",
          commandId: CommandId.make("cmd-meta"),
          channelId: CHANNEL,
          name: "renamed",
        },
        { type: "channel.archive", commandId: CommandId.make("cmd-arch"), channelId: CHANNEL },
        { type: "channel.unarchive", commandId: CommandId.make("cmd-unarch"), channelId: CHANNEL },
        {
          type: "channel.member.add",
          commandId: CommandId.make("cmd-add"),
          channelId: CHANNEL,
          member: {
            handle: ChannelMemberHandle.make("boss3"),
            memberKind: "thread" as const,
            memberId: "thread-boss3",
          },
        },
        {
          type: "channel.member.remove",
          commandId: CommandId.make("cmd-rm"),
          channelId: CHANNEL,
          handle: BOSS1,
        },
        postCommand({}),
      ] as const;

      // Administration needs a human issuer and authoring needs a member one,
      // so the post carries its own. A single issuer for the whole list would
      // refuse half of them and the loop would prove nothing.
      let compared = 0;
      for (const command of commands) {
        const base = makeReadModel();
        // channel.unarchive is refused on a live channel, so it gets an archived
        // one. A single fixture would refuse it, and a refused command emits no
        // events and would drop out of this loop silently.
        const readModel =
          command.type === "channel.unarchive"
            ? {
                ...base,
                channels: base.channels.map((channel) => ({ ...channel, archivedAt: NOW })),
              }
            : base;
        const decided = yield* decideOrchestrationCommand({
          command,
          readModel,
          issuer: command.type === "channel.post.create" ? PM_ISSUER : ADMIN,
        });
        const events = Array.isArray(decided) ? decided : [decided];
        for (const event of events) {
          expect(event.aggregateKind).toBe("channel");
          expect(event.aggregateId).toBe(CHANNEL);
          compared += 1;
        }
      }
      // A refused command emits no events and drops out of the loop silently,
      // so the count is what stops this passing while proving nothing.
      expect(compared, "every command in the list must have produced an event").toBe(
        commands.length,
      );
    }),
  );

  it.effect("stores a channel name canonically, whatever the caller typed", () =>
    Effect.gen(function* () {
      // An agent types "#Seniors"; another types "seniors". They must reach the
      // same channel. A failed name lookup is deliberately indistinguishable
      // from "you are not a member", so a case mismatch would otherwise be
      // unreportable — the one place that conflation is unhelpful. The decider
      // is the guarantee; the toolkit normalises only for a readable error.
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "channel.create",
          commandId: CommandId.make("cmd-create-case"),
          channelId: ChannelId.make("channel-case"),
          name: "  #Juniors  ",
          members: [{ handle: PM, memberKind: "thread", memberId: "thread-pm" }],
          createdAt: NOW,
        },
        readModel: makeReadModel(),
        issuer: ADMIN,
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("channel.created");
      if (events[0]?.type === "channel.created") {
        expect(events[0].payload.name).toBe("juniors");
      }
    }),
  );

  // canonicalChannelName.test.ts pins the rule itself. These two prove it is
  // WIRED on both write paths — the rename is the one most easily left behind,
  // and an unchecked rename can retire a reachable name to "" just as a create can.
  it.effect("refuses to create a channel whose name has no canonical form", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "channel.create",
          commandId: CommandId.make("cmd-create-sigil"),
          channelId: ChannelId.make("channel-sigil"),
          // Passes TrimmedNonEmptyString, canonicalises to "".
          name: "#",
          members: [{ handle: PM, memberKind: "thread", memberId: "thread-pm" }],
          createdAt: NOW,
        },
        readModel: makeReadModel(),
        issuer: ADMIN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("no canonical form");
      }
    }),
  );

  it.effect("refuses to rename a channel to a name with no canonical form", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "channel.meta.update",
          commandId: CommandId.make("cmd-meta-sigil"),
          channelId: CHANNEL,
          name: "##",
        },
        readModel: makeReadModel(),
        issuer: ADMIN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("no canonical form");
      }
    }),
  );

  it.effect("strips every leading sigil, not just the first", () =>
    Effect.gen(function* () {
      // "##seniors" is a fat-finger that must reach the existing channel rather
      // than create a second one the toolkit can never look up.
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "channel.create",
          commandId: CommandId.make("cmd-create-sigils"),
          channelId: ChannelId.make("channel-sigils"),
          name: "  ##JUNIORS  ",
          members: [{ handle: PM, memberKind: "thread", memberId: "thread-pm" }],
          createdAt: NOW,
        },
        readModel: makeReadModel(),
        issuer: ADMIN,
      });
      const events = Array.isArray(decided) ? decided : [decided];
      // Asserted, not just narrowed: a wrong event type makes the branch below
      // unreachable and the test passes having checked nothing.
      expect(events[0]?.type).toBe("channel.created");
      if (events[0]?.type === "channel.created") {
        expect(events[0].payload.name).toBe("juniors");
      }
    }),
  );

  // The handle fold has to be on EVERY write path, not just create: a mention
  // is matched against stored membership, so one unfolded path stores a handle
  // that no mention written any other way can reach.
  it.effect("stores member handles canonically when a channel is created", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "channel.create",
          commandId: CommandId.make("cmd-create-handles"),
          channelId: ChannelId.make("channel-handles"),
          name: "project",
          members: [
            {
              handle: ChannelMemberHandle.make("@PM"),
              memberKind: "thread",
              memberId: "thread-pm",
            },
          ],
          createdAt: NOW,
        },
        readModel: makeReadModel(),
        issuer: ADMIN,
      });
      const events = Array.isArray(decided) ? decided : [decided];
      // Asserted, not just narrowed: a wrong event type makes the branch below
      // unreachable and the test passes having checked nothing.
      expect(events[0]?.type).toBe("channel.created");
      if (events[0]?.type === "channel.created") {
        expect(events[0].payload.members[0]?.handle).toBe(PM);
      }
    }),
  );

  it.effect("stores a member handle canonically when one is added", () =>
    Effect.gen(function* () {
      // The add path needs its own test: the create path folding proves nothing
      // about this branch, and a member added with its typed handle is a member
      // no mention can reach. Dropping the fold here passed the whole suite.
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "channel.member.add",
          commandId: CommandId.make("cmd-add-case"),
          channelId: CHANNEL,
          member: {
            handle: ChannelMemberHandle.make("@Boss3"),
            memberKind: "thread",
            memberId: "thread-boss3",
          },
        },
        readModel: makeReadModel(),
        issuer: ADMIN,
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("channel.member-added");
      if (events[0]?.type === "channel.member-added") {
        expect(events[0].payload.member.handle).toBe(ChannelMemberHandle.make("boss3"));
      }
    }),
  );

  // A member whose handle canonicalises to NOTHING is the source of a whole
  // family of bugs one layer up: keyed on "", it gets woken by every spelling
  // that also canonicalises to nothing. The aggregate refuses to create such a
  // member at all, which is what makes that member impossible rather than
  // merely handled. Both write paths, because one of them refusing is not the
  // aggregate refusing.
  it.effect("refuses a member whose handle has no canonical form on create", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "channel.create",
          commandId: CommandId.make("cmd-create-sigil-handle"),
          channelId: ChannelId.make("channel-sigil-handle"),
          name: "juniors",
          members: [
            {
              // Passes the branded TrimmedNonEmptyString, canonicalises to "".
              handle: ChannelMemberHandle.make("@"),
              memberKind: "thread",
              memberId: "thread-nobody",
            },
          ],
          createdAt: NOW,
        },
        readModel: makeReadModel(),
        issuer: ADMIN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("no canonical form");
      }
    }),
  );

  it.effect("refuses a member whose handle has no canonical form on add", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "channel.member.add",
          commandId: CommandId.make("cmd-add-sigil-handle"),
          channelId: CHANNEL,
          member: {
            handle: ChannelMemberHandle.make("@@"),
            memberKind: "thread",
            memberId: "thread-nobody",
          },
        },
        readModel: makeReadModel(),
        issuer: ADMIN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("no canonical form");
      }
    }),
  );

  it.effect("collides two handles that differ only by composition", () =>
    Effect.gen(function* () {
      // Decomposed and composed spellings of the same text are one handle, so a
      // second member cannot hold the other spelling. Without NFC these are two
      // members that render identically, and nothing tells a reader of the member
      // list which one a mention reached.
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "channel.create",
          commandId: CommandId.make("cmd-create-nfc"),
          channelId: ChannelId.make("channel-nfc"),
          name: "juniors",
          members: [
            {
              handle: ChannelMemberHandle.make("caf\u00e9"),
              memberKind: "thread",
              memberId: "thread-a",
            },
            {
              handle: ChannelMemberHandle.make("caf\u0065\u0301"),
              memberKind: "thread",
              memberId: "thread-b",
            },
          ],
          createdAt: NOW,
        },
        readModel: makeReadModel(),
        issuer: ADMIN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("is used twice");
      }
    }),
  );

  it.effect("collides two handles that differ only by case", () =>
    Effect.gen(function* () {
      // "Boss1" and "boss1" are two rows but one mention key, which is exactly
      // the ambiguity the uniqueness check exists to prevent. Comparing raw
      // handles would admit both and make "@boss1" wake an arbitrary one.
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "channel.create",
          commandId: CommandId.make("cmd-create-case-handles"),
          channelId: ChannelId.make("channel-case-handles"),
          name: "project",
          members: [
            {
              handle: ChannelMemberHandle.make("Boss1"),
              memberKind: "thread",
              memberId: "thread-a",
            },
            { handle: BOSS1, memberKind: "thread", memberId: "thread-b" },
          ],
          createdAt: NOW,
        },
        readModel: makeReadModel(),
        issuer: ADMIN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("is used twice");
      }
    }),
  );

  it.effect("removes the member a differently-cased handle names", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "channel.member.remove",
          commandId: CommandId.make("cmd-remove-case"),
          channelId: CHANNEL,
          handle: ChannelMemberHandle.make("@Boss1"),
        },
        readModel: makeReadModel(),
        issuer: ADMIN,
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("channel.member-removed");
      if (events[0]?.type === "channel.member-removed") {
        expect(events[0].payload.handle).toBe(BOSS1);
      }
    }),
  );

  it.effect("resolves a mention written with a sigil and the wrong case", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: postCommand({ mentions: ["@Boss1"] }),
        readModel: makeReadModel(),
        issuer: PM_ISSUER,
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("channel.post-created");
      if (events[0]?.type === "channel.post-created") {
        expect(events[0].payload.mentions).toEqual([BOSS1]);
      }
    }),
  );

  // Migration 051 holds a UNIQUE index on name. Without a decider check the
  // command is admitted and the projection refuses it, so the caller gets
  // SQLITE(2067) naming the driver instead of the problem. Canonicalisation
  // makes this MORE reachable, not less: "#Seniors" now collides with
  // "seniors", which is the whole point of folding.
  it.effect("refuses recreating a channel id, even under a free name", () =>
    Effect.gen(function* () {
      // requireChannelAbsent was UNPINNED: making it inert passed all 602 tests.
      // The engine restart test's comment says it guards this, and it does not —
      // requireChannelNameAvailable now refuses that recreate first, so the test
      // passes for a different reason than the one it names. A fix of mine masked
      // the guard standing next to it.
      //
      // A FREE name is the input that separates them: name availability passes, so
      // only requireChannelAbsent can refuse this.
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "channel.create",
          commandId: CommandId.make("cmd-create-same-id"),
          // The id the fixture already holds.
          channelId: CHANNEL,
          name: "a-name-nobody-holds",
          members: [{ handle: PM, memberKind: "thread", memberId: "thread-pm" }],
          createdAt: NOW,
        },
        readModel: makeReadModel(),
        issuer: ADMIN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("cannot be created twice");
      }
    }),
  );

  it.effect("refuses a second channel whose canonical name is already taken", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "channel.create",
          commandId: CommandId.make("cmd-create-dupe-name"),
          channelId: ChannelId.make("channel-dupe"),
          // The seeded channel is stored as "seniors".
          name: "#Seniors",
          members: [{ handle: PM, memberKind: "thread", memberId: "thread-pm" }],
          createdAt: NOW,
        },
        readModel: makeReadModel(),
        issuer: ADMIN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("is already used by channel");
      }
    }),
  );

  it.effect("counts an archived channel as still holding its name", () =>
    Effect.gen(function* () {
      // The unique index carries no WHERE clause, so an archived channel keeps
      // its name. Excluding archived channels here would admit a command the
      // projection still refuses — the same gap moved one branch over.
      const readModel = makeReadModel();
      const archived = {
        ...readModel,
        channels: readModel.channels.map((channel) => ({ ...channel, archivedAt: NOW })),
      };
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "channel.create",
          commandId: CommandId.make("cmd-create-dupe-archived"),
          channelId: ChannelId.make("channel-dupe-archived"),
          name: "seniors",
          members: [{ handle: PM, memberKind: "thread", memberId: "thread-pm" }],
          createdAt: NOW,
        },
        readModel: archived,
        issuer: ADMIN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("is already used by channel");
      }
    }),
  );

  it.effect("refuses a rename onto a name another channel holds", () =>
    Effect.gen(function* () {
      // The rename half of the name check, which nothing pinned: the two
      // refusal tests both go through channel.create, and the self-rename test
      // below asserts only the PERMISSIVE direction — a test that checks a
      // guard lets something through cannot show the guard is there. Deleting
      // the call from the meta.update branch passed all 636 tests.
      //
      // Needs a SECOND channel, which the shared fixture does not have: with
      // one channel there is nothing to collide a rename against.
      const base = makeReadModel();
      const first = base.channels[0];
      expect(first, "fixture must seed a channel to rename against").toBeDefined();
      if (first === undefined) return;
      const twoChannels = {
        ...base,
        channels: [first, { ...first, id: ChannelId.make("channel-juniors"), name: "juniors" }],
      };
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "channel.meta.update",
          commandId: CommandId.make("cmd-meta-collide"),
          channelId: ChannelId.make("channel-juniors"),
          // Canonicalises to "seniors", which the other channel holds.
          name: "#SENIORS",
        },
        readModel: twoChannels,
        issuer: ADMIN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("is already used by channel");
      }
    }),
  );

  it.effect("lets a channel keep its own name across a rename", () =>
    Effect.gen(function* () {
      // exceptChannelId: renaming "seniors" to "#SENIORS" is a no-op, not a
      // self-collision. Without the exception every rename would refuse itself.
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "channel.meta.update",
          commandId: CommandId.make("cmd-meta-self"),
          channelId: CHANNEL,
          name: "#SENIORS",
        },
        readModel: makeReadModel(),
        issuer: ADMIN,
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("channel.meta-updated");
      if (events[0]?.type === "channel.meta-updated") {
        expect(events[0].payload.name).toBe("seniors");
      }
    }),
  );

  it.effect("creates a channel and stamps createdAt and updatedAt together", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "channel.create",
          commandId: CommandId.make("cmd-create-2"),
          channelId: ChannelId.make("channel-3"),
          name: "project",
          members: [{ handle: PM, memberKind: "thread", memberId: "thread-pm" }],
          createdAt: NOW,
        },
        readModel: makeReadModel(),
        issuer: ADMIN,
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("channel.created");
      if (events[0]?.type === "channel.created") {
        expect(events[0].payload.createdAt).toBe(NOW);
        expect(events[0].payload.updatedAt).toBe(NOW);
        expect(events[0].aggregateKind).toBe("channel");
      }
    }),
  );
});
