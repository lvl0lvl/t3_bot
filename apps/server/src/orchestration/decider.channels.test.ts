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
    threads: [],
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

function postCommand(overrides: {
  readonly authorMemberId?: string;
  readonly mentions?: ReadonlyArray<string>;
}) {
  return {
    type: "channel.post.create",
    commandId: CommandId.make("cmd-post-1"),
    channelId: CHANNEL,
    postId: ChannelPostId.make("post-1"),
    authorRef: {
      memberKind: "thread" as const,
      memberId: overrides.authorMemberId ?? "thread-pm",
    },
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
        command: postCommand({ authorMemberId: "thread-stranger" }),
        readModel: makeReadModel(),
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
      // runs first, so a non-member never reaches it. The ordering is the
      // control; this pins it, because swapping the two guards is a one-line
      // change that would turn the error into a membership oracle.
      const error = yield* decideOrchestrationCommand({
        command: postCommand({ authorMemberId: "thread-stranger", mentions: ["boss1", "nobody"] }),
        readModel: makeReadModel(),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("Author is not a member");
        expect(error.detail).not.toContain("nobody");
        expect(error.detail).not.toContain("boss1");
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
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      // Pins THIS invariant: without it another guard firing first would
      // satisfy the _tag and the test would survive deleting the one it names.
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("is used twice");
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

      for (const command of commands) {
        const decided = yield* decideOrchestrationCommand({ command, readModel: makeReadModel() });
        const events = Array.isArray(decided) ? decided : [decided];
        for (const event of events) {
          expect(event.aggregateKind).toBe("channel");
          expect(event.aggregateId).toBe(CHANNEL);
        }
      }
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
          name: "  #Seniors  ",
          members: [{ handle: PM, memberKind: "thread", memberId: "thread-pm" }],
          createdAt: NOW,
        },
        readModel: makeReadModel(),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("channel.created");
      if (events[0]?.type === "channel.created") {
        expect(events[0].payload.name).toBe("seniors");
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
          name: "  ##SENIORS  ",
          members: [{ handle: PM, memberKind: "thread", memberId: "thread-pm" }],
          createdAt: NOW,
        },
        readModel: makeReadModel(),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      if (events[0]?.type === "channel.created") {
        expect(events[0].payload.name).toBe("seniors");
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
      });
      const events = Array.isArray(decided) ? decided : [decided];
      if (events[0]?.type === "channel.created") {
        expect(events[0].payload.members[0]?.handle).toBe(PM);
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
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("channel.post-created");
      if (events[0]?.type === "channel.post-created") {
        expect(events[0].payload.mentions).toEqual([BOSS1]);
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
