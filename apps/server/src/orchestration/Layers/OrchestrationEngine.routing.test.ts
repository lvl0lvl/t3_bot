import {
  ChannelId,
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
 * branch. It cannot prove a command sits in the RIGHT one: a payload carrying
 * both a `projectId` and a `threadId` type-checks in either, so moving
 * `thread.pull-request.sync` into the project group compiles clean and leaves
 * the engine suite green. This table is the assertion the compiler cannot make.
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
};

/**
 * The shape the command union is declared in. Annotating it structurally rather
 * than walking the schema's internals means a restructure — including adding a
 * bare Struct to the top-level union instead of into a sub-union — fails to
 * compile here, pointing at one line, instead of being silently skipped by a
 * reflective walk that cannot read it.
 */
type CommandGroup = {
  readonly members: ReadonlyArray<{
    readonly fields: { readonly type: { readonly literal: string } };
  }>;
};

/**
 * The command types the contract declares, read from the schema rather than
 * hand-listed: a command added to the union must be routed deliberately or the
 * table test below fails naming it. A hand-written list would rot silently.
 */
const declaredCommandTypes = (): ReadonlyArray<string> => {
  const groups: ReadonlyArray<CommandGroup> = OrchestrationCommand.members;
  const members = groups.flatMap((group) => group.members);
  const types = [...new Set(members.map((member) => member.fields.type.literal))];
  // Every leaf must have yielded a readable literal. A member the accessor
  // cannot read would otherwise be skipped in silence, and a command that is
  // never enumerated is never routing-checked.
  expect(members.every((member) => typeof member.fields.type.literal === "string")).toBe(true);
  return types.sort();
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
      let decided = 0;
      const disagreements: Array<string> = [];

      for (const type of declaredCommandTypes()) {
        const command = probe(type);
        const ref = commandToAggregateRef(command);
        if (ref === null) continue;

        const planned = yield* decideOrchestrationCommand({
          command,
          readModel: readModel(),
          // `exit`, not `result`: a probe payload that omits a command's own
          // fields makes some decider cases DEFECT rather than reject, and a
          // defect is not a typed failure. Either way the command simply did
          // not produce events to compare, and the rejected-receipt path is
          // covered by the table test above.
        }).pipe(Effect.exit);

        if (planned._tag !== "Success") continue;

        const events = Array.isArray(planned.value) ? planned.value : [planned.value];
        if (events.length === 0) continue;
        decided += 1;

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
      // Without this the assertion above is vacuous: if every probe were
      // rejected, `disagreements` would be empty because nothing was compared.
      expect(
        decided,
        "too few commands produced events; the agreement above compared almost nothing",
      ).toBeGreaterThan(15);
    }),
  );
});
