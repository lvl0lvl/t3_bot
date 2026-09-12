import {
  ChannelId,
  ChannelMemberHandle,
  ChannelPostId,
  CommandId,
  OrchestrationCommand,
  type CommandIssuer,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const CHANNEL = ChannelId.make("channel-1");
const BOSS1 = ChannelMemberHandle.make("boss1");

const HUMAN: CommandIssuer = { memberKind: "human", memberId: "human-walt" };
const SYSTEM: CommandIssuer = { memberKind: "system", memberId: "checkpoint-reactor" };
const MEMBER_THREAD: CommandIssuer = { memberKind: "thread", memberId: "thread-boss1" };
const OUTSIDER_THREAD: CommandIssuer = { memberKind: "thread", memberId: "thread-stranger" };

function readModel(): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [],
    channels: [
      {
        id: CHANNEL,
        name: "seniors",
        members: [{ handle: BOSS1, memberKind: "thread", memberId: "thread-boss1" }],
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
      const refused: Array<string> = [];
      for (const type of channelCommandTypes()) {
        const command = channelProbe(type);
        expect(command, `no probe for ${type} — add one`).toBeDefined();
        if (command === undefined) continue;
        const exit = yield* Effect.exit(
          decideOrchestrationCommand({
            command: command as never,
            readModel: readModel(),
          }),
        );
        if (exit._tag === "Failure") refused.push(type);
      }
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
      // The mirror of the test above. Without it, a guard that refused EVERY
      // issuer would pass that one and lock the feature out entirely.
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
        expect(error.detail).toContain("is archived and cannot accept new posts");
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
});
