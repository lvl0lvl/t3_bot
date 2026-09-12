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
 * IDEMPOTENCE IS BY RECEIPT. Every command below carries a DETERMINISTIC
 * commandId, so the engine's command-receipt idempotency short-circuits the
 * second boot before the decider ever sees it. That is why there is no error
 * handling around "already exists" anywhere here: on boot 2 nothing reaches the
 * decider at all.
 *
 * There is exactly ONE read, and it is not there for idempotence — the receipt
 * already covers that. It is there because a DIFFERENT writer owns the same
 * subject: `autoBootstrapProjectFromCwd` also creates a project for the server's
 * cwd, and two projects for one workspace root is what
 * `requireActiveProjectWorkspaceRootAbsent` refuses. See `seedHierarchy` for why
 * that read is safe to separate from its write.
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
  ProviderInstanceId,
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

/** What a seeded thread should run. */
const SEEDED_MODEL_SELECTION = {
  instanceId: defaultInstanceIdForDriver(CLAUDE_DRIVER_KIND),
  model: "claude-opus-5",
} as const;

/**
 * What the seeder stored BEFORE `t3_bot-4ii` — an instance id no build can
 * resolve, because the driver's kind is `claudeAgent` and this said `claude`.
 *
 * It is here as data rather than as a memory because the repair has to
 * recognise exactly this and nothing else. "Any unresolvable instance" would
 * also match a thread the operator has since re-pointed at a provider they have
 * not installed, and silently dragging that back to Claude is a worse bug than
 * the one being repaired.
 */
const PRE_4II_MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make("claude"),
  model: "claude-opus-5",
} as const;

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
 * The read costs this one step its pure idempotence-by-receipt, and it is worth
 * being exact about what does and does not make that safe. It is NOT "the
 * command worker serialises it": the read is a projection query and does not run
 * on that worker at all. It is safe because the only other writer of a project
 * for this root runs strictly after this phase returns, and because the create
 * still carries a deterministic id — so even a lost race degrades to a refused
 * duplicate rather than a second hierarchy.
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
      // FROM THE DRIVER, never spelled here. This was
      // `ProviderDriverKind.make("claude")` and the driver's kind is
      // `claudeAgent` — a branded slug, so the typo typechecked, shipped, and
      // made every wake fail with "references unknown provider instance
      // 'claude'". Nothing in the suite could see it: no test resolved a seeded
      // instanceId against the provider registry.
      modelSelection: SEEDED_MODEL_SELECTION,
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

  // REPAIR, for a database seeded before `t3_bot-4ii`.
  //
  // The create above short-circuits on its receipt — the check compares the
  // commandId and the aggregate ref and never the payload — so fixing the
  // instance id in that command fixes nothing on a database that has already
  // booted. Its threads keep pointing at `claude`, every wake fails at the
  // provider boundary, and the seeder reports success. That is the same trap
  // the `#seniors` membership hit one file over, and I fixed it there without
  // looking one command up.
  //
  // Repairing only the EXACT pre-4ii selection, rather than "any unresolvable
  // instance": an operator who has re-pointed a seeded thread at a provider
  // they have not installed yet would otherwise have it dragged back to Claude
  // by a seeder they did not ask to run.
  const seededBefore = yield* projections.getCommandReadModel();
  for (const thread of SEEDED_THREADS) {
    const current = seededBefore.threads.find((row) => row.id === thread.id);
    if (
      current === undefined ||
      current.deletedAt !== null ||
      current.modelSelection.instanceId !== PRE_4II_MODEL_SELECTION.instanceId ||
      current.modelSelection.model !== PRE_4II_MODEL_SELECTION.model
    ) {
      continue;
    }
    yield* dispatch({
      type: "thread.meta.update",
      commandId: CommandId.make(`seed-thread-${thread.handle}-model-4ii`),
      threadId: thread.id,
      modelSelection: SEEDED_MODEL_SELECTION,
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
};
