import {
  ChannelId,
  ChannelMemberHandle,
  ChannelPostId,
  CommandId,
  OrchestrationCommand,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationAggregateKind,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "../decider.ts";
import { __testing } from "./OrchestrationEngine.ts";

const { commandToAggregateRef } = __testing;

const PROJECT_ID = ProjectId.make("project-under-test");
const THREAD_ID = ThreadId.make("thread-under-test");
const CHANNEL_ID = ChannelId.make("channel-under-test");
const ARCHIVED_CHANNEL_ID = ChannelId.make("channel-archived-under-test");
const CHANNEL_HANDLE = ChannelMemberHandle.make("boss1");

/**
 * The id a correctly-routed command of each kind must carry. Keyed on the
 * contract's own aggregate-kind union rather than a pair of literals, so a
 * fourth aggregate cannot be added without this failing to compile, and a
 * command of a kind this file has not considered cannot be silently compared
 * against the wrong id.
 */
const ID_FOR_KIND: Readonly<Record<OrchestrationAggregateKind, string>> = {
  project: PROJECT_ID,
  thread: THREAD_ID,
  channel: CHANNEL_ID,
};
const NOW = "2026-01-01T00:00:00.000Z";

/**
 * Where each command's command receipt belongs.
 *
 * What `commandToAggregateRef` actually scopes is narrower than it looks, and
 * worth stating because the obvious reading is wrong. Its only consumers are
 * the span and metric attributes, the idempotency conflict check
 * (OrchestrationEngine.ts:221), and the REJECTED receipt (:462). Events do not
 * route through it — the decider stamps `aggregateKind` on every event itself —
 * and `hasEventAfter` hardcodes `"thread"` at both call sites (:245, :261), so
 * neither can be corrupted by a misplaced case here.
 *
 * `command satisfies never` in that function proves every command has SOME
 * branch, and for most commands the compiler already blocks the wrong one: a
 * payload carrying only one id does not type-check in the other group, which
 * settles 37 of the 39 declared commands — 34 thread-only and 3 project-only.
 *
 * The hazard is the two carrying BOTH ids, `thread.create` and
 * `thread.pull-request.sync`, because those type-check in either group. Moving
 * either compiles clean, and moving `thread.pull-request.sync` was measured to
 * leave the pre-existing orchestration suite green at 41 files / 539 tests.
 * This table covers them, and keeps that set honest as payloads gain ids: a
 * command that grows a second id silently joins the hazardous set without any
 * other signal.
 */
const EXPECTED_AGGREGATE: Readonly<Record<string, OrchestrationAggregateKind>> = {
  "project.create": "project",
  "project.meta.update": "project",
  "project.delete": "project",
  "thread.create": "thread",
  "thread.delete": "thread",
  "thread.archive": "thread",
  "thread.unarchive": "thread",
  "thread.settle": "thread",
  "thread.unsettle": "thread",
  "thread.snooze": "thread",
  "thread.unsnooze": "thread",
  "thread.pin": "thread",
  "thread.unpin": "thread",
  "thread.pin.reorder": "thread",
  "thread.active.reorder": "thread",
  "thread.meta.update": "thread",
  "thread.pull-request.link": "thread",
  "thread.pull-request.unlink": "thread",
  "thread.pull-request.sync": "thread",
  "thread.pull-request-link.sync": "thread",
  "thread.runtime-mode.set": "thread",
  "thread.interaction-mode.set": "thread",
  "thread.turn.start": "thread",
  "thread.turn.interrupt": "thread",
  "thread.turn.diff.complete": "thread",
  "thread.approval.respond": "thread",
  "thread.user-input.respond": "thread",
  "thread.user-input.dismiss": "thread",
  "thread.checkpoint.revert": "thread",
  "thread.session.set": "thread",
  "thread.session.stop": "thread",
  "thread.auto-settle": "thread",
  "thread.message.assistant.delta": "thread",
  "thread.message.assistant.complete": "thread",
  "thread.history.import": "thread",
  "thread.proposed-plan.upsert": "thread",
  "thread.activity.append": "thread",
  "thread.revert.complete": "thread",
  "thread.title.regeneration.complete": "thread",
  // Channel commands carry channelId alone, so they are not members of the
  // dual-id hazard set this table's derivation selects — that derivation will
  // not pick them up and an empty uncovered-hazards result says nothing about
  // them. They need naming here explicitly, and the assertion below names them.
  "channel.create": "channel",
  "channel.meta.update": "channel",
  "channel.archive": "channel",
  "channel.unarchive": "channel",
  "channel.member.add": "channel",
  "channel.member.remove": "channel",
  "channel.post.create": "channel",
};

/**
 * Channel commands that must appear in the executed comparison.
 *
 * Asserted by NAME rather than by count: "seven were compared" is satisfied by
 * any seven, and stops meaning these seven the moment an eighth lands or one of
 * these drops out and an unrelated command drops in.
 */
const CHANNEL_COMMAND_TYPES = [
  "channel.create",
  "channel.meta.update",
  "channel.archive",
  "channel.unarchive",
  "channel.member.add",
  "channel.member.remove",
  "channel.post.create",
] as const;

/**
 * The shape the command union is declared in. Annotating it structurally rather
 * than walking the schema's internals means a restructure — including adding a
 * bare Struct to the top-level union instead of into a sub-union — fails to
 * compile here, pointing at one line, instead of being silently skipped by a
 * reflective walk that cannot read it.
 */
type CommandGroup = {
  readonly members: ReadonlyArray<{
    readonly fields: Readonly<Record<string, unknown>> & {
      readonly type: { readonly literal: string };
    };
  }>;
};

/**
 * The command types the contract declares, read from the schema rather than
 * hand-listed: a command added to the union must be routed deliberately or the
 * table test below fails naming it. A hand-written list would rot silently.
 *
 * Deduplicated on purpose. The union has 41 members for 39 types, because
 * `thread.pull-request.sync` and `thread.pull-request-link.sync` are each
 * declared twice; counting members instead of types is how a count in a comment
 * drifts from the thing it claims to describe.
 */
const declaredCommandTypes = (): ReadonlyArray<string> => {
  const groups: ReadonlyArray<CommandGroup> = OrchestrationCommand.members;
  const members = groups.flatMap((group) => group.members);
  const types = [...new Set(members.map((member) => member.fields.type.literal))];
  // Every leaf must have yielded a readable literal. A member the accessor
  // cannot read would otherwise be skipped in silence, and a command that is
  // never enumerated is never routing-checked. Reported by position and field
  // names rather than as a bare boolean: an unreadable member has no type
  // literal to name it by, so those are the only handles a maintainer gets.
  const unreadable = members
    .map((member, index) => ({ index, member }))
    .filter(({ member }) => typeof member.fields.type.literal !== "string")
    .map(({ index, member }) => `#${index} {${Object.keys(member.fields).sort().join(",")}}`);
  expect(
    unreadable,
    "these union members did not yield a type literal, so their commands are never routing-checked",
  ).toEqual([]);
  return types.sort();
};

/**
 * The commands whose payload carries BOTH a projectId and a threadId — the only
 * ones the compiler cannot already keep out of the wrong branch. Derived from
 * the contract rather than listed, so a command that grows a second id joins
 * the hazard set automatically instead of silently escaping it.
 *
 * This scopes ROUTER misplacement only. The agreement test also catches a
 * decider stamping the wrong aggregate, and that hazard is wider — a decider
 * literal is a string, so any command can carry the wrong one, single-id or
 * not. An empty uncovered set is not coverage against that; closing it means
 * driving the commands whose bare probe the decider refuses (t3_bot-aig).
 */
const dualIdCommandTypes = (): ReadonlyArray<string> => {
  const groups: ReadonlyArray<CommandGroup> = OrchestrationCommand.members;
  return [
    ...new Set(
      groups
        .flatMap((group) => group.members)
        .filter((member) => "projectId" in member.fields && "threadId" in member.fields)
        .map((member) => member.fields.type.literal),
    ),
  ].sort();
};

/**
 * Payload fields a command needs before the decider will produce events for it.
 * Only the hazard set needs them: every other command is either satisfied by
 * the bare probe or is legitimately skipped, but a hazard-set command that the
 * decider refuses is a command the agreement test cannot see at all.
 */
const PROBE_EXTRAS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  // A thread id the read model does not already hold: creating the existing one
  // is rejected, which is what kept this command out of the comparison.
  // The seeded channel is what lets the other five past requireChannel, and it
  // is exactly what makes this one fail: requireChannelAbsent refuses an id the
  // read model already holds. A different id, so the probe creates rather than
  // collides.
  "channel.create": {
    channelId: ChannelId.make("channel-created-by-probe"),
    name: "probe-channel",
    members: [],
    createdAt: NOW,
  },
  // The live channel refuses this; the archived one is its only valid target.
  "channel.unarchive": { channelId: ARCHIVED_CHANNEL_ID },
  // A handle AND a `(memberKind, memberId)` the seeded channel does not already
  // hold. A fresh handle used to be enough; `requireChannelMembersUnique` now
  // also refuses a second row for one member ref (`t3_bot-1ez`), and this probe
  // reused the seeded member's id. A human rather than a thread because a thread
  // member must name a live thread and this fixture holds exactly one.
  "channel.member.add": {
    member: {
      handle: ChannelMemberHandle.make("added-by-probe"),
      memberKind: "human",
      memberId: "human-added-by-probe",
    },
  },
  // The seeded handle, because removing one that is not a member is refused.
  "channel.member.remove": { handle: CHANNEL_HANDLE },
  // The author must BE a member and every mention must resolve to one, so both
  // point at the seeded member rather than at anything invented here.
  "channel.post.create": {
    postId: ChannelPostId.make("post-by-probe"),
    authorRef: { memberKind: "thread", memberId: THREAD_ID },
    body: "probe",
    mentions: [CHANNEL_HANDLE],
    parentPostId: null,
    createdAt: NOW,
  },
  "thread.create": {
    threadId: ThreadId.make("thread-created-by-probe"),
    title: "Probe thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt: NOW,
  },
  // `expected` is the optimistic-concurrency snapshot and must match the read
  // model's thread and project exactly, or the decider refuses the command.
  "thread.pull-request.sync": {
    snapshotSequence: 0,
    expected: {
      branch: null,
      worktreePath: null,
      linkedPullRequest: null,
      branchPullRequest: null,
      workspaceRoot: "/workspace/project",
    },
  },
};

/**
 * Every id kind on every probe, deliberately. A command carrying only the id
 * its own branch reads would be routed correctly by any branch, so the probe
 * has to make the wrong branch *succeed* at producing the wrong answer. Add a
 * new id here whenever an aggregate kind is added, or that kind's commands
 * route to `undefined` and the assertion passes for the wrong reason.
 */
const probe = (type: string): OrchestrationCommand =>
  ({
    type,
    commandId: CommandId.make(`cmd-${type}`),
    projectId: PROJECT_ID,
    threadId: THREAD_ID,
    channelId: CHANNEL_ID,
  }) as unknown as OrchestrationCommand;

/**
 * The same probe, plus whatever a command needs before the decider will act on
 * it. Kept separate because the extras can change the ids: the table test must
 * see the bare probe so its id assertion stays meaningful, while the agreement
 * test compares the router and the decider against each other and only needs
 * them to agree on whatever the payload carries.
 */
const decidableProbe = (type: string): OrchestrationCommand =>
  ({
    ...(probe(type) as unknown as Record<string, unknown>),
    ...PROBE_EXTRAS[type],
  }) as unknown as OrchestrationCommand;

const readModel = (): OrchestrationReadModel => ({
  snapshotSequence: 0,
  projects: [
    {
      id: PROJECT_ID,
      title: "Project",
      workspaceRoot: "/workspace/project",
      defaultModelSelection: null,
      scripts: [],
      repositoryIdentity: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      threadEnvMode: null,
      faviconPath: null,
      projectIcon: null,
      autoPull: null,
    },
  ] as unknown as OrchestrationReadModel["projects"],
  threads: [
    {
      id: THREAD_ID,
      projectId: PROJECT_ID,
      title: "Thread",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      pullRequests: [],
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      unsettledAt: null,
      activeOrderKey: null,
      snoozedUntil: null,
      snoozedAt: null,
      pinnedAt: null,
      pinOrderKey: null,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    },
  ] as unknown as OrchestrationReadModel["threads"],
  // Seeded, not created by the probe. Six of the seven channel commands call
  // requireChannel first and are refused without it — and a refused command
  // emits no events, so it drops out of the executed comparison silently.
  // The member is here for the same reason: channel.post.create additionally
  // checks the author and its mentions against membership.
  channels: [
    {
      id: CHANNEL_ID,
      name: "seniors",
      members: [{ handle: CHANNEL_HANDLE, memberKind: "thread" as const, memberId: THREAD_ID }],
      archivedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    // channel.unarchive is refused on a live channel, and channel.archive on an
    // archived one, so one channel cannot serve both probes. Without this the
    // unarchive probe emits no events and drops out of the comparison.
    {
      id: ARCHIVED_CHANNEL_ID,
      name: "retired",
      members: [{ handle: CHANNEL_HANDLE, memberKind: "thread" as const, memberId: THREAD_ID }],
      archivedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  updatedAt: NOW,
});

it("routes every declared command to the aggregate that owns its receipt", () => {
  for (const type of declaredCommandTypes()) {
    const expected = EXPECTED_AGGREGATE[type];
    expect(expected, `${type} is not in the expected-routing table — add it`).toBeDefined();
    // Unreachable: the assertion above throws. Present so the id lookup below
    // is indexed by a known kind rather than `string | undefined`.
    if (expected === undefined) continue;
    const ref = commandToAggregateRef(probe(type));
    expect(ref, `${type} has no branch in commandToAggregateRef`).not.toBeNull();
    expect(ref?.aggregateKind, `${type} routed to the wrong aggregate kind`).toBe(expected);
    // The id matters as much as the kind: a misroute stamps a real aggregate,
    // just the wrong one, and that is what corrupts the receipt.
    expect(ref?.aggregateId, `${type} routed to the wrong aggregate id`).toBe(
      ID_FOR_KIND[expected],
    );
  }
});

it("has no table entry for a command the contract no longer declares", () => {
  const declared = new Set(declaredCommandTypes());
  const stale = Object.keys(EXPECTED_AGGREGATE).filter((type) => !declared.has(type));
  expect(stale, "these table entries name commands that no longer exist").toEqual([]);
});

it("returns null rather than throwing for a command with no branch", () => {
  // The engine runs this on its single command-queue worker fiber: a throw
  // there kills the fiber and hangs every later command on an unsettled
  // Deferred, so an unroutable command must be rejectable, not fatal.
  expect(commandToAggregateRef(probe("thread.does-not-exist"))).toBeNull();
});

it.layer(NodeServices.layer)("router and decider agree", (it) => {
  /**
   * The invariant that actually protects the command receipt.
   *
   * There are TWO independent command-to-aggregate mappings: this router's 39
   * cases, and the ~51 `aggregateKind` literals the decider stamps on events.
   * The ACCEPTED receipt is written from the decider's event
   * (OrchestrationEngine.ts:366) while the idempotency conflict check compares
   * the ROUTER's answer (:221). If the two disagree, a legitimate replay of a
   * commandId raises a conflict against a command that already succeeded.
   *
   * Nothing else detects that: the compiler cannot, `satisfies never` cannot,
   * and asserting the router against a hand-written table cannot either.
   */
  it.effect("every event a command produces carries the aggregate the router computed", () =>
    Effect.gen(function* () {
      const compared: Array<string> = [];
      const disagreements: Array<string> = [];

      for (const type of declaredCommandTypes()) {
        const command = decidableProbe(type);
        const ref = commandToAggregateRef(command);
        if (ref === null) continue;

        const planned = yield* decideOrchestrationCommand({
          command,
          readModel: readModel(),
          // Channel commands are refused without an issuer, so the probe
          // carries one or every channel row would drop out of the comparison
          // and this table would go green having compared nothing.
          issuer:
            type === "channel.post.create"
              ? { memberKind: "thread", memberId: THREAD_ID }
              : { memberKind: "human", memberId: "human-walt" },
          // `exit`, not `result`: a probe payload that omits a command's own
          // fields makes some decider cases DEFECT rather than reject, and a
          // defect is not a typed failure. Either way the command simply did
          // not produce events to compare, and the rejected-receipt path is
          // covered by the table test above.
        }).pipe(Effect.exit);

        if (planned._tag !== "Success") continue;

        const events = Array.isArray(planned.value) ? planned.value : [planned.value];
        if (events.length === 0) continue;
        compared.push(type);

        for (const event of events) {
          if (event === undefined || typeof event !== "object" || !("aggregateKind" in event)) {
            disagreements.push(`${type}: decider returned an entry with no aggregateKind`);
            continue;
          }
          if (event.aggregateKind !== ref.aggregateKind || event.aggregateId !== ref.aggregateId) {
            disagreements.push(
              `${type}: router said ${ref.aggregateKind}/${ref.aggregateId}, ` +
                `decider stamped ${event.aggregateKind}/${event.aggregateId} on ${event.type}`,
            );
          }
        }
      }

      expect(disagreements, "router and decider disagree about who owns these commands").toEqual(
        [],
      );
      // Naming what went uncompared, rather than counting it. A probe payload
      // the decider refuses is skipped silently, so without this the commands
      // that matter most can drop out of the comparison and the test still
      // passes — which is exactly what happened: the first version of this test
      // skipped both dual-id commands, and flipping the decider's aggregate for
      // `thread.pull-request.sync` left the whole suite green.
      const uncoveredHazards = dualIdCommandTypes().filter((type) => !compared.includes(type));
      expect(
        uncoveredHazards,
        "these commands carry both ids, so only this test can catch a misroute — and it did not compare them",
      ).toEqual([]);

      // The channel commands are NOT in the dual-id hazard set — they carry
      // channelId alone — so the assertion above is silent about them and would
      // pass with all seven skipped. Six of them call requireChannel first and
      // emit nothing if the read model lacks the channel, which is precisely
      // how they would drop out. Named rather than counted: "seven compared"
      // is satisfied by any seven.
      const uncoveredChannels = CHANNEL_COMMAND_TYPES.filter((type) => !compared.includes(type));
      expect(
        uncoveredChannels,
        "these channel commands were never compared — a refused probe emits no events and drops out silently",
      ).toEqual([]);
    }),
  );
});
