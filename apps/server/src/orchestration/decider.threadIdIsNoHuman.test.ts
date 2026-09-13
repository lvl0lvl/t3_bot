import {
  ChannelId,
  ChannelMemberHandle,
  CommandId,
  HUMAN_OPERATOR_MEMBER_ID,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

/**
 * `thread.create` refuses a thread id that is a human's member id (`t3_bot-7iw`).
 *
 * The property is about ORDERING: the shape guard already refuses a human
 * member whose id names an existing thread, so the only way to one id under
 * two kinds was human first, thread second. Every fixture here seats the human
 * FIRST and then asks for the thread, because that is the input the guard
 * exists for; the other order is the shape guard's and is pinned in
 * `decider.issuer.test.ts`.
 *
 * The seated human is `human-owner`, not the operator, so the two refusals the
 * guard can give are told apart by their detail: a seated id names its channel,
 * the operator's id names the operator. A fixture that used the operator for
 * both would pass with either clause deleted.
 */

const NOW = "2026-01-01T00:00:00.000Z";
const PROJECT = ProjectId.make("project-1");
const CHANNEL = ChannelId.make("channel-seniors");
const SECOND_CHANNEL = ChannelId.make("channel-juniors");
const OWNER_ID = "human-owner";
const DELETED_THREAD_ID = "thread-gone";
const ADMIN = { memberKind: "human", memberId: HUMAN_OPERATOR_MEMBER_ID } as const;

interface ChannelInput {
  readonly id: ChannelId;
  readonly members: ReadonlyArray<{
    readonly handle: string;
    readonly memberKind: "thread" | "human";
    readonly memberId: string;
  }>;
  readonly archivedAt?: string | null;
}

// One channel (`CHANNEL`) with these members, or exactly the channels given.
function readModel(
  input:
    | { readonly members: ChannelInput["members"]; readonly archivedAt?: string | null }
    | { readonly channels: ReadonlyArray<ChannelInput> },
): OrchestrationReadModel {
  const channels =
    "channels" in input
      ? input.channels
      : [{ id: CHANNEL, members: input.members, archivedAt: input.archivedAt }];
  return {
    snapshotSequence: 0,
    projects: [
      {
        id: PROJECT,
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModelSelection: null,
        scripts: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ] as unknown as OrchestrationReadModel["projects"],
    threads: [
      // A thread that was deleted: its id may be created again, and a channel
      // may still list it as a THREAD member.
      { id: DELETED_THREAD_ID, deletedAt: NOW },
    ] as unknown as OrchestrationReadModel["threads"],
    channels: channels.map((channel) => ({
      id: channel.id,
      name: channel.id,
      members: channel.members.map((member) => ({
        handle: ChannelMemberHandle.make(member.handle),
        memberKind: member.memberKind,
        memberId: member.memberId,
      })),
      archivedAt: channel.archivedAt ?? null,
      createdAt: NOW,
      updatedAt: NOW,
    })),
    updatedAt: NOW,
  };
}

function createThread(threadId: string) {
  return {
    type: "thread.create" as const,
    commandId: CommandId.make(`cmd-create-${threadId}`),
    threadId: ThreadId.make(threadId),
    projectId: PROJECT,
    title: "A thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    branch: null,
    worktreePath: null,
    createdAt: NOW,
  };
}

it.layer(NodeServices.layer)("thread.create refuses a human's member id", (it) => {
  it.effect("refuses a thread id that a channel holds as a HUMAN member", () =>
    Effect.gen(function* () {
      // Human seated first, thread asked for second: the ordering the shape
      // guard admits and this guard exists to close.
      const error = yield* decideOrchestrationCommand({
        command: createThread(OWNER_ID),
        readModel: readModel({
          members: [{ handle: "owner", memberKind: "human", memberId: OWNER_ID }],
        }),
        issuer: ADMIN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain(`'${OWNER_ID}' is a human member of channel '${CHANNEL}'`);
      }
    }),
  );

  it.effect("looks at an ARCHIVED channel's roster too", () =>
    Effect.gen(function* () {
      // A roster does not stop being a roster when the channel is archived: a
      // guard that skipped archived channels would admit this id, and the
      // channel can be unarchived with the collision already seated.
      const error = yield* decideOrchestrationCommand({
        command: createThread(OWNER_ID),
        readModel: readModel({
          members: [{ handle: "owner", memberKind: "human", memberId: OWNER_ID }],
          archivedAt: NOW,
        }),
        issuer: ADMIN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("is a human member of channel");
      }
    }),
  );

  it.effect("refuses a thread id that a human holds in a channel that is not the first", () =>
    Effect.gen(function* () {
      // Two channels. The first lists the id only as a THREAD member; the
      // second seats the human under it. A scan of `channels[0]` alone finds
      // no human and admits the thread — the mutation this test is written
      // against — so the detail has to name the SECOND channel.
      const error = yield* decideOrchestrationCommand({
        command: createThread(OWNER_ID),
        readModel: readModel({
          channels: [
            {
              id: CHANNEL,
              members: [{ handle: "owner", memberKind: "thread", memberId: OWNER_ID }],
            },
            {
              id: SECOND_CHANNEL,
              members: [{ handle: "owner", memberKind: "human", memberId: OWNER_ID }],
            },
          ],
        }),
        issuer: ADMIN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain(
          `'${OWNER_ID}' is a human member of channel '${SECOND_CHANNEL}'`,
        );
      }
    }),
  );

  it.effect("refuses the operator's id when NO channel seats it yet", () =>
    Effect.gen(function* () {
      // `noSeedHierarchy`: nothing is seated, so the seated check finds
      // nothing. A thread created now with the operator's id makes the
      // seeder's own `channel.create` fail on the next boot, because the
      // shape guard refuses the human member once the thread exists. The
      // seated check alone admits this input; the constant refuses it.
      const error = yield* decideOrchestrationCommand({
        command: createThread(HUMAN_OPERATOR_MEMBER_ID),
        readModel: readModel({ channels: [] }),
        issuer: ADMIN,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("is the operator's member id");
      }
    }),
  );

  it.effect("admits a deleted thread's id that a channel still lists as a THREAD member", () =>
    Effect.gen(function* () {
      // The admit side. `requireThreadAbsent` blocks only a live row, so a
      // deleted draft's id comes back; the channel still lists the old member,
      // and that member is a thread, not a human. A guard widened to "any
      // seated member id" refuses this and turns every recreated draft into a
      // refusal — the mutation this test is written against.
      const decided = yield* decideOrchestrationCommand({
        command: createThread(DELETED_THREAD_ID),
        readModel: readModel({
          members: [
            { handle: "owner", memberKind: "human", memberId: OWNER_ID },
            { handle: "gone", memberKind: "thread", memberId: DELETED_THREAD_ID },
          ],
        }),
        issuer: ADMIN,
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("thread.created");
      if (events[0]?.type === "thread.created") {
        expect(events[0].payload.threadId).toBe(DELETED_THREAD_ID);
      }
    }),
  );
});
