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
 * IDEMPOTENCE IS BY RECEIPT, not by reading first. Every command below carries a
 * DETERMINISTIC commandId, so the engine's command-receipt idempotency
 * short-circuits the second boot before the decider ever sees it. That is why
 * there is no "does it already exist" query here and no error handling around
 * "already exists": on boot 2 nothing reaches the decider at all. Reading first
 * would also be a lie about atomicity — the read and the write are separate, and
 * only the receipt makes the repeat safe.
 *
 * CHANNELS COME LAST, and on this tree that is convention rather than
 * enforcement. Once `t3_bot-8i2` lands, a channel member of kind `thread` must
 * resolve to a LIVE thread and seeding channels first FAILS. Today nothing
 * refuses it, and a guard sweep confirmed the reorder is invisible to the whole
 * suite — so this comment says what is true now, not what is true in the branch
 * this was written alongside.
 */
import {
  ChannelId,
  ChannelMemberHandle,
  CommandId,
  ProjectId,
  ProviderDriverKind,
  ThreadId,
  defaultInstanceIdForDriver,
  type CommandIssuer,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

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
const PROJECT_ID = ProjectId.make("project-t3bot");
const PM_THREAD = ThreadId.make("thread-pm");
const BOSS1_THREAD = ThreadId.make("thread-boss1");
const BOSS3_THREAD = ThreadId.make("thread-boss3");
const PROJECT_CHANNEL = ChannelId.make("channel-project");
const SENIORS_CHANNEL = ChannelId.make("channel-seniors");

/**
 * The human's member id.
 *
 * There is no human-identity concept on `main` yet, so this is a fixed value
 * rather than a real account id. It is the field the web UI will need in order
 * to render "you", and it is recorded on `t3_bot-1nx` as the thing to replace
 * when identities exist. Deliberately NOT a thread id: a human member carrying
 * a thread's id is the impersonation route `requireChannelMemberShape` refuses.
 */
const WALT_MEMBER_ID = "human-walt";

const SEEDED_THREADS = [
  { id: PM_THREAD, handle: "pm", title: "PM" },
  { id: BOSS1_THREAD, handle: "boss1", title: "Boss1" },
  { id: BOSS3_THREAD, handle: "boss3", title: "Boss3" },
] as const;

/**
 * Seed the hierarchy, or do nothing because it is already seeded.
 *
 * `workspaceRoot` is the path the seeded project points at. It is a parameter
 * rather than a constant because the seeder cannot know it: the server has no
 * environment-level notion of "its own repository", and inventing one here would
 * create a second project for a path nobody chose.
 */
export const seedHierarchy = Effect.fn("seedHierarchy")(function* (input: {
  readonly workspaceRoot: string;
  readonly createdAt: string;
}) {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const dispatch = (command: Parameters<typeof engine.dispatch>[0]) =>
    engine.dispatch(command, { issuer: SEED_ISSUER });

  yield* dispatch({
    type: "project.create",
    commandId: CommandId.make("seed-project"),
    projectId: PROJECT_ID,
    title: "t3_bot",
    workspaceRoot: input.workspaceRoot,
    createdAt: input.createdAt,
  });

  for (const thread of SEEDED_THREADS) {
    yield* dispatch({
      type: "thread.create",
      commandId: CommandId.make(`seed-thread-${thread.handle}`),
      threadId: thread.id,
      projectId: PROJECT_ID,
      title: thread.title,
      modelSelection: {
        instanceId: defaultInstanceIdForDriver(ProviderDriverKind.make("claude")),
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

  // Channels last: once 8i2 lands a `thread` member must resolve to a live
  // thread, and until then this ordering is correct but unenforced.
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
});

export const __testing = {
  PROJECT_ID,
  SENIORS_CHANNEL,
  PROJECT_CHANNEL,
  SEEDED_THREADS,
  WALT_MEMBER_ID,
  SEED_ISSUER,
};
