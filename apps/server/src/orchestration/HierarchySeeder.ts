/**
 * Seeds the agent hierarchy the M1 demo needs: one project, the pm/boss1/boss3
 * threads, and the #project and #seniors channels.
 *
 * WHY A SEEDER AND NOT A MIGRATION: these are orchestration COMMANDS, not rows.
 * A migration writing projection tables directly would produce a channel with no
 * events behind it — unreachable to replay, invisible to every invariant, and
 * exactly the fake state the channel tests had until the member-shape invariant
 * refused them all. Going through the engine means the seeded hierarchy is
 * subject to the same rules as anything a user creates.
 *
 * IDEMPOTENCE IS BY RECEIPT, which is why the creates need no error handling
 * around "already exists": every command carries a DETERMINISTIC commandId, so
 * the engine's receipt short-circuit stops a re-decide before the decider sees
 * it. That receipt compares the commandId and the aggregate ref and NEVER the
 * payload — which is also why correcting a shipped command's payload is silently
 * skipped wherever it has already run. The instance repair in `seedHierarchy` is
 * one command that DOES reach the decider on boot 2, and it gets there by
 * carrying an id of its own rather than by editing one.
 *
 * There are TWO reads, and neither is there for idempotence — the receipts cover
 * that. The first exists because a DIFFERENT writer owns the same subject:
 * `autoBootstrapProjectFromCwd` also creates a project for the server's cwd, and
 * two projects for one workspace root is what
 * `requireActiveProjectWorkspaceRootAbsent` refuses. The second exists because
 * the repair has to know what a thread's selection is now. `seedHierarchy` says
 * what each costs and what makes each safe, and the two arguments are different.
 *
 * CHANNELS COME LAST, and whether that is convention or enforcement depends on
 * one thing: whether `requireChannelMemberShape` is present. It refuses a
 * channel member of kind `thread` whose id is not a live thread, so where it
 * exists, seeding channels first fails outright — measured on a tree carrying
 * both changes: three tests red with
 * `Member 'pm' claims memberKind 'thread' but 'thread-pm' is not a thread.`
 * Where it does not exist, the ordering is still correct and simply unenforced,
 * and a reorder is invisible to the whole suite.
 *
 * Stated as a condition rather than a date because a date goes stale on its own
 * and a condition does not: `grep requireChannelMemberShape` answers it.
 */
import {
  CLAUDE_DRIVER_KIND,
  ChannelId,
  ChannelMemberHandle,
  CommandId,
  HUMAN_OPERATOR_MEMBER_ID,
  ProjectId,
  ThreadId,
  defaultInstanceIdForDriver,
  type CommandIssuer,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ProjectionSnapshotQuery from "./Services/ProjectionSnapshotQuery.ts";
import * as OrchestrationEngine from "./Services/OrchestrationEngine.ts";

/**
 * The seeder acts as `system`: it administers channels and authors nothing.
 *
 * `system` is the only issuer kind that can create a channel without being a
 * member of it, and it deliberately cannot post — a seeder has no handle and
 * nothing to say.
 */
const SEED_ISSUER: CommandIssuer = { memberKind: "system", memberId: "hierarchy-seeder" };

/**
 * Fixed ids, so the second boot's commands are the same commands.
 *
 * These are the seed's whole idempotence mechanism, so they must never be
 * generated. A fresh id per boot would create a second hierarchy on every
 * restart and every invariant would be satisfied while doing it.
 */
const SEED_PROJECT_ID = ProjectId.make("project-t3bot");
const PM_THREAD = ThreadId.make("thread-pm");
const BOSS1_THREAD = ThreadId.make("thread-boss1");
const BOSS3_THREAD = ThreadId.make("thread-boss3");
const PROJECT_CHANNEL = ChannelId.make("channel-project");
const SENIORS_CHANNEL = ChannelId.make("channel-seniors");

/**
 * The instance id this seeder SHIPPED with, which no build can resolve.
 *
 * A literal rather than `defaultInstanceIdForDriver(ProviderDriverKind.make("claude"))`,
 * which is what produced it: writing the typo again to describe the typo invites someone to
 * "fix" this line and silently disarm the repair below. This is a historical fact about what
 * is in databases, not a value the product derives.
 *
 * The Claude driver's kind is `claudeAgent`. `ProviderDriverKind` is a branded slug, so
 * `make("claude")` typechecked, stored, and failed four layers downstream at the provider
 * boundary with "references unknown provider instance 'claude'".
 */
const SHIPPED_BAD_INSTANCE_ID = "claude";

/**
 * The human's member id, from the one place that defines it.
 *
 * It was a local constant here and is now shared with the WebSocket layer,
 * which stamps the same value as the issuer on every command a browser sends.
 * Two definitions would mean an operator who is a member of a channel they
 * cannot post to. Deliberately NOT a thread id: a human member carrying a
 * thread's id is the impersonation route `requireChannelMemberShape` exists to
 * refuse.
 */
const WALT_MEMBER_ID = HUMAN_OPERATOR_MEMBER_ID;

const SEEDED_THREADS = [
  { id: PM_THREAD, handle: "pm", title: "PM" },
  { id: BOSS1_THREAD, handle: "boss1", title: "Boss1" },
  { id: BOSS3_THREAD, handle: "boss3", title: "Boss3" },
] as const;

/**
 * Seed the hierarchy for `workspaceRoot`, or do nothing because it is already
 * seeded.
 *
 * IT ASKS WHICH PROJECT OWNS THE ROOT BEFORE CREATING ONE, which is the whole
 * correction. An earlier version created its own unconditionally and would have
 * failed on the first real boot: the server's own `autoBootstrapProjectFromCwd`
 * path creates a project for the same root, and
 * `requireActiveProjectWorkspaceRootAbsent` refuses a second one. Its test
 * passed throughout, because the fixture created no other project.
 *
 * Asking first is exactly what that bootstrap does. It does not take the id from
 * the bootstrap phase instead, because that phase is FORKED — startup does not
 * await it — so a seeder hanging off it would race the thing it depends on. The
 * startup wiring resolves that the other way: `hierarchy.seed` runs to
 * completion BEFORE the bootstrap fork, so the read below sees a settled world
 * and the bootstrap then resolves the project this seeded rather than creating
 * a second one.
 *
 * The project read costs THAT step its pure idempotence-by-receipt, and it is
 * worth being exact about what does and does not make it safe. It is NOT "the
 * command worker serialises it": the read is a projection query and does not run
 * on that worker at all. It is safe because the only other writer of a project
 * for this root runs strictly after this phase returns, and because the create
 * still carries a deterministic id — so even a lost race degrades to a refused
 * duplicate rather than a second hierarchy. The second read, below the creates,
 * is safe for a different reason and says so there: this argument does not carry
 * over to it.
 */
export const seedHierarchy = Effect.fn("seedHierarchy")(function* (input: {
  readonly workspaceRoot: string;
  readonly createdAt: string;
}) {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const projections = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const dispatch = (command: Parameters<typeof engine.dispatch>[0]) =>
    engine.dispatch(command, { issuer: SEED_ISSUER });

  const existingProject = yield* projections.getActiveProjectByWorkspaceRoot(input.workspaceRoot);
  const projectId = Option.isSome(existingProject)
    ? existingProject.value.id
    : yield* Effect.as(
        dispatch({
          type: "project.create",
          commandId: CommandId.make("seed-project"),
          projectId: SEED_PROJECT_ID,
          title: "t3_bot",
          workspaceRoot: input.workspaceRoot,
          createdAt: input.createdAt,
        }),
        SEED_PROJECT_ID,
      );

  for (const thread of SEEDED_THREADS) {
    yield* dispatch({
      type: "thread.create",
      commandId: CommandId.make(`seed-thread-${thread.handle}`),
      threadId: thread.id,
      projectId,
      title: thread.title,
      modelSelection: {
        // FROM THE DRIVER, never spelled here. This was
        // `ProviderDriverKind.make("claude")` and the driver's kind is
        // `claudeAgent` — a branded slug, so the typo typechecked, shipped, and
        // made every wake fail with "references unknown provider instance
        // 'claude'". Nothing in the suite could see it: no test resolves a
        // seeded instanceId against the provider registry.
        instanceId: defaultInstanceIdForDriver(CLAUDE_DRIVER_KIND),
        model: "claude-opus-5",
      },
      // Auto, so the demo does not stall on an approval prompt nobody is
      // watching. A seeded agent thread that needs a human to unblock it is not
      // a demo of agents talking to each other.
      runtimeMode: "auto",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: input.createdAt,
    });
  }

  // THE CREATES ABOVE DO NOTHING ON AN ENVIRONMENT THAT HAS ALREADY BOOTED — the receipt
  // short-circuit stated below `channel.member.add`, doing its job. The consequence is what
  // this command exists for: #16's correction to `instanceId` lands on a fresh database and is
  // skipped everywhere that booted before it, so those threads keep `instanceId: 'claude'`,
  // every mention-wake fails at the provider boundary, and `seedHierarchy` returns success.
  // Observed on a scratch home that had booted once (`t3_bot-p4u`). A NEW id is the whole fix.
  //
  // WHAT MAKES THIS READ SAFE IS NOT THE DETERMINISTIC ID. That id stops the repair from
  // running twice; it does nothing about the repair overwriting a concurrent writer's value
  // from a stale read, which is last-writer-wins data loss — the outcome the old-value guard
  // below exists to prevent. It is safe because no other writer of `thread.modelSelection` can
  // run in this window: every client command is behind `commandGate.enqueueCommand`, whose gate
  // is signalled long after this phase (`serverRuntimeStartup.ts`), and no reactor writes
  // `modelSelection` at all. A writer that is not behind that gate makes this read need
  // re-arguing rather than re-reading.
  //
  // The read is the whole command read model for three `instanceId` values, accepted rather
  // than overlooked: two earlier startup phases already load it
  // (`markRunningProviderSessionsForContinuation`, `reconcileProviderSessions`), so this is a
  // third load on a path already paying two. `getThreadShellById` is the narrower read when
  // that stops being true — `t3_bot-ofl`.
  //
  // THE ALTERNATIVE WAS A MIGRATION, and `persistence/Migrations/046_RepairAutomaticSettlementTimestamps.ts`
  // is the precedent: same discipline, identifying rows by the signature of the bad write. A
  // command wins here for the reason the header gives — it goes through the engine and is subject
  // to the invariants — but a migration retires itself by number and this loop does not. It runs on
  // every boot of every environment forever, and `t3_bot-0fx` carries the condition for deleting
  // it: no database predating #16 can still be booted.
  const readModel = yield* projections.getCommandReadModel();
  for (const thread of SEEDED_THREADS) {
    const existing = readModel.threads.find((row) => row.id === thread.id);
    // ABSENT IS NOT THE FRESH-BOOT CASE. Measured: the create above is visible to this read
    // with no drain in between, so on a first boot `existing` is defined, carries the right
    // instance, and the guard below is what skips it. Absent means the row is not readable yet
    // — a projector cursor behind the event log — and then dispatching nothing is right: no
    // receipt is written, so the next boot repairs it.
    if (existing === undefined) {
      continue;
    }
    // THE OLD VALUE, NOT "ANYTHING UNRESOLVABLE". An operator who has re-pointed a thread
    // owns that choice even if this build cannot resolve it either — a seeder that overwrote
    // it would be worse than the bug. So this fires only on the exact id that shipped.
    //
    // A DELETED OR ARCHIVED THREAD IS STILL REPAIRED: the read is unfiltered and this asks only
    // about the instance, so an undelete or unarchive lands on a repaired row rather than on the
    // bug, and nothing wakes a deleted thread in the meantime. Whether a delete should count as
    // stronger ownership than a re-point is `t3_bot-40z`, and it is not settled here.
    if (existing.modelSelection.instanceId !== SHIPPED_BAD_INSTANCE_ID) {
      continue;
    }
    yield* dispatch({
      type: "thread.meta.update",
      commandId: CommandId.make(`seed-thread-${thread.handle}-instance-repair`),
      threadId: thread.id,
      // SPREAD, not a fresh selection. `modelSelection` is replaced wholesale by this
      // command, so writing `{ instanceId, model }` would discard a `model` or `options` the
      // operator had changed. Repairing the one field the seeder got wrong is the difference
      // between fixing a thread and re-seeding it.
      modelSelection: {
        ...existing.modelSelection,
        instanceId: defaultInstanceIdForDriver(CLAUDE_DRIVER_KIND),
      },
    });
  }

  // Channels last, because a `thread` member must resolve to a live thread
  // wherever `requireChannelMemberShape` is present. See the header.
  yield* dispatch({
    type: "channel.create",
    commandId: CommandId.make("seed-channel-project"),
    channelId: PROJECT_CHANNEL,
    name: "project",
    members: [
      { handle: ChannelMemberHandle.make("walt"), memberKind: "human", memberId: WALT_MEMBER_ID },
      { handle: ChannelMemberHandle.make("pm"), memberKind: "thread", memberId: PM_THREAD },
    ],
    createdAt: input.createdAt,
  });

  yield* dispatch({
    type: "channel.create",
    commandId: CommandId.make("seed-channel-seniors"),
    channelId: SENIORS_CHANNEL,
    name: "seniors",
    members: SEEDED_THREADS.map((thread) => ({
      handle: ChannelMemberHandle.make(thread.handle),
      memberKind: "thread" as const,
      memberId: thread.id,
    })),
    createdAt: input.createdAt,
  });

  // The operator joins #seniors as its OWN command, with its own id, and not by
  // being added to the list above.
  //
  // NEVER CHANGE THE PAYLOAD OF A DETERMINISTIC COMMAND THAT HAS SHIPPED. The
  // receipt short-circuit compares the commandId and the aggregate ref and never
  // the payload, so editing `seed-channel-seniors`'s members is a change that
  // silently does not happen on every environment that has already booted — and
  // `seedHierarchy` still returns success. The operator would then be missing
  // from the channel M1 is a demonstration of, and the symptom would be
  // `requireChannelAuthorIsMember` refusing their post with a message about
  // membership that is true and useless.
  //
  // A new id is the whole fix. Bumping the CREATE's id would not work:
  // `requireChannelAbsent` and `requireChannelNameAvailable` both refuse a
  // second create for a channel that exists.
  //
  // Why the operator is in here at all is a product decision rather than a
  // technical one: M1 is Walt asking "@boss1 what is 2+2" in #seniors and
  // watching the seniors answer each other. It is not a way around the
  // membership check — `requireChannelAuthorIsMember` still decides, and it
  // decides on the list this produces.
  yield* dispatch({
    type: "channel.member.add",
    commandId: CommandId.make("seed-channel-seniors-member-walt"),
    channelId: SENIORS_CHANNEL,
    member: {
      handle: ChannelMemberHandle.make("walt"),
      memberKind: "human",
      memberId: WALT_MEMBER_ID,
    },
  });
});

export const __testing = {
  SENIORS_CHANNEL,
  PROJECT_CHANNEL,
  SEEDED_THREADS,
  WALT_MEMBER_ID,
  SEED_ISSUER,
  // So a test can replay the OLD seed under the ids the old seeder used, rather than
  // approximating it — the whole point is that those receipts already exist.
  SEED_PROJECT_ID,
};
