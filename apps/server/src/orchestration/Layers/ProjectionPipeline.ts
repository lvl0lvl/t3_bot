import {
  ApprovalRequestId,
  isImportedAgentSessionMessageId,
  UserInputAttachmentAnswerPayload,
  type ChatAttachment,
  OrchestrationAggregateKind,
  type OrchestrationEvent,
  OrchestrationEventType,
  type OrchestrationSessionStatus,
  ThreadId,
} from "@t3tools/contracts";
import { compareDateTimeStrings } from "@t3tools/shared/dateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  legacyThreadPullRequestKey,
  threadPullRequestKeysEqual,
} from "@t3tools/shared/threadPullRequests";

import { toPersistenceSqlError, type ProjectionRepositoryError } from "../../persistence/Errors.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { ProjectionPendingApprovalRepository } from "../../persistence/Services/ProjectionPendingApprovals.ts";
import { ProjectionChannelRepositoryLive } from "../../persistence/Layers/ProjectionChannels.ts";
import { ProjectionChannelRepository } from "../../persistence/Services/ProjectionChannels.ts";
import { ChannelPostWakeRepositoryLive } from "../../persistence/Layers/ChannelPostWakes.ts";
import { ChannelPostWakeRepository } from "../../persistence/Services/ChannelPostWakes.ts";
import { parseWakeKey } from "./MentionWakeReactor.ts";
import { ProjectionProjectRepository } from "../../persistence/Services/ProjectionProjects.ts";
import {
  type ProjectionDecoderEpoch,
  ProjectionDecoderRepository,
} from "../../persistence/Services/ProjectionDecoder.ts";
import {
  type ProjectionState,
  ProjectionStateRepository,
} from "../../persistence/Services/ProjectionState.ts";
import { ProjectionThreadActivityRepository } from "../../persistence/Services/ProjectionThreadActivities.ts";
import { type ProjectionThreadActivity } from "../../persistence/Services/ProjectionThreadActivities.ts";
import {
  type ProjectionThreadMessage,
  ProjectionThreadMessageRepository,
} from "../../persistence/Services/ProjectionThreadMessages.ts";
import {
  type ProjectionThreadProposedPlan,
  ProjectionThreadProposedPlanRepository,
} from "../../persistence/Services/ProjectionThreadProposedPlans.ts";
import * as ProjectionThreadPullRequests from "../../persistence/ProjectionThreadPullRequests.ts";
import { ProjectionThreadSessionRepository } from "../../persistence/Services/ProjectionThreadSessions.ts";
import {
  type ProjectionTurn,
  ProjectionTurnRepository,
} from "../../persistence/Services/ProjectionTurns.ts";
import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import { ProjectionPendingApprovalRepositoryLive } from "../../persistence/Layers/ProjectionPendingApprovals.ts";
import { ProjectionProjectRepositoryLive } from "../../persistence/Layers/ProjectionProjects.ts";
import { ProjectionDecoderRepositoryLive } from "../../persistence/Layers/ProjectionDecoder.ts";
import { ProjectionStateRepositoryLive } from "../../persistence/Layers/ProjectionState.ts";
import { ProjectionThreadActivityRepositoryLive } from "../../persistence/Layers/ProjectionThreadActivities.ts";
import { ProjectionThreadMessageRepositoryLive } from "../../persistence/Layers/ProjectionThreadMessages.ts";
import { ProjectionThreadProposedPlanRepositoryLive } from "../../persistence/Layers/ProjectionThreadProposedPlans.ts";
import { ProjectionThreadSessionRepositoryLive } from "../../persistence/Layers/ProjectionThreadSessions.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import { ProjectionThreadRepositoryLive } from "../../persistence/Layers/ProjectionThreads.ts";
import { ServerConfig } from "../../config.ts";
import {
  OrchestrationProjectionPipeline,
  type OrchestrationProjectionPipelineShape,
} from "../Services/ProjectionPipeline.ts";
import {
  attachmentRelativePath,
  parseAttachmentIdFromRelativePath,
  parseThreadSegmentFromAttachmentId,
  toSafeThreadAttachmentSegment,
} from "../../attachmentStore.ts";

export const ORCHESTRATION_PROJECTOR_NAMES = {
  projects: "projection.projects",
  threads: "projection.threads",
  threadMessages: "projection.thread-messages",
  threadProposedPlans: "projection.thread-proposed-plans",
  threadActivities: "projection.thread-activities",
  threadSessions: "projection.thread-sessions",
  threadTurns: "projection.thread-turns",
  checkpoints: "projection.checkpoints",
  pendingApprovals: "projection.pending-approvals",
  channels: "projection.channels",
} as const;

type ProjectorName =
  (typeof ORCHESTRATION_PROJECTOR_NAMES)[keyof typeof ORCHESTRATION_PROJECTOR_NAMES];

// Every table a projector writes, plus the cursors. A rebuild empties all of
// them in one transaction and then runs the same replay a fresh database
// runs, so the rebuilt state is the fresh-install state by construction. The
// input that breaks this list: a projector that writes a table not named
// here, whose stale rows would survive the rebuild. Every writer reachable
// from here is an upsert, channel_post_wake's included (ChannelPostWakes.ts,
// ON CONFLICT DO UPDATE, idempotent because the projector replays), so the
// replay recreates every row the log still implies; what an upsert cannot do
// is remove a row the log no longer implies, which is why the table is emptied
// rather than left to the replay. Measure the list with
// `rg -o "(INSERT( OR (IGNORE|REPLACE))? INTO|UPDATE|DELETE FROM) [a-z_]+"`
// over the thirteen repository MODULES the Live layer at the bottom of this
// file provides — not over a `Layers/Projection*.ts` glob, which misses
// ProjectionThreadPullRequests.ts (it sits outside Layers/) and picks up
// ProjectionCheckpoints.ts (the pipeline does not provide it). That command
// returns these fourteen names plus projection_decoder, the ledger, which a
// rebuild deletes separately.
const PROJECTION_TABLES = [
  "projection_projects",
  "projection_threads",
  "projection_thread_messages",
  "projection_thread_proposed_plans",
  "projection_thread_activities",
  "projection_thread_sessions",
  "projection_turns",
  "projection_pending_approvals",
  "projection_channels",
  "projection_channel_members",
  "projection_channel_posts",
  "projection_thread_pull_requests",
  "channel_post_wake",
  "projection_state",
] as const;

// What this build can decode, read from the schemas' AST so the ledger and
// the unions cannot drift (the same accessors the store test pins).
const decodableEventTypes: ReadonlyArray<string> = OrchestrationEventType.literals;
const decodableAggregateKinds: ReadonlyArray<string> = OrchestrationAggregateKind.literals;

// A log value bounded and quoted for the message text. The
// preferSchemaOverJson diagnostic refuses `JSON.stringify` here; this is the
// encoder it names, and it produces the same bounded, quoted text the store's
// skip warning does (Layers/OrchestrationEventStore.ts, same two columns). The
// warning's annotations keep the raw value.
const quoteForLog = Schema.encodeSync(Schema.fromJsonString(Schema.String));

/** One epoch, with the part of this build's lists that epoch does not carry. */
type LackingEpoch = {
  readonly epoch: ProjectionDecoderEpoch;
  readonly eventTypes: ReadonlyArray<string>;
  readonly aggregateKinds: ReadonlyArray<string>;
};

/**
 * Turn state to settle still-running turns with when their session leaves the
 * "running" status, or null while the session is (re)starting or running and
 * turns must stay unsettled.
 */
function settledTurnStateForSessionStatus(
  status: OrchestrationSessionStatus,
): "completed" | "interrupted" | "error" | null {
  switch (status) {
    case "idle":
    case "ready":
      return "completed";
    case "error":
      return "error";
    case "interrupted":
    case "stopped":
      return "interrupted";
    case "starting":
    case "running":
      return null;
  }
}

interface ProjectorDefinition {
  readonly name: ProjectorName;
  readonly apply: (
    event: OrchestrationEvent,
    attachmentSideEffects: AttachmentSideEffects,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

interface AttachmentSideEffects {
  readonly deletedThreadIds: Set<string>;
  readonly prunedThreadRelativePaths: Map<string, Set<string>>;
}

const materializeAttachmentsForProjection = Effect.fn("materializeAttachmentsForProjection")(
  (input: { readonly attachments: ReadonlyArray<ChatAttachment> }) =>
    Effect.succeed(input.attachments.length === 0 ? [] : input.attachments),
);

function extractActivityRequestId(payload: unknown): ApprovalRequestId | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const requestId = (payload as Record<string, unknown>).requestId;
  return typeof requestId === "string" ? ApprovalRequestId.make(requestId) : null;
}

function isStalePendingApprovalFailureDetail(detail: string | null): boolean {
  if (detail === null) {
    return false;
  }
  return (
    detail.includes("stale pending approval request") ||
    detail.includes("unknown pending approval request") ||
    detail.includes("unknown pending permission request")
  );
}

// A refresh reads each persisted summary source, so skip activities that cannot change the result.
function shouldRefreshThreadShellSummary(event: OrchestrationEvent): boolean {
  if (event.type !== "thread.activity-appended") {
    return true;
  }

  switch (event.payload.activity.kind) {
    case "approval.requested":
    case "approval.resolved":
    case "provider.approval.respond.failed":
    case "user-input.requested":
    case "user-input.resolved":
    case "provider.user-input.respond.failed":
      return true;
    default:
      return false;
  }
}

function derivePendingUserInputCountFromActivities(
  activities: ReadonlyArray<ProjectionThreadActivity>,
): number {
  const openRequestIds = new Set<string>();
  const ordered = [...activities].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.activityId.localeCompare(right.activityId),
  );

  for (const activity of ordered) {
    const requestId = extractActivityRequestId(activity.payload);
    if (requestId === null) {
      continue;
    }
    const payload =
      typeof activity.payload === "object" && activity.payload !== null
        ? (activity.payload as Record<string, unknown>)
        : null;
    const detail = typeof payload?.detail === "string" ? payload.detail.toLowerCase() : null;

    if (activity.kind === "user-input.requested") {
      openRequestIds.add(requestId);
      continue;
    }

    if (activity.kind === "user-input.resolved") {
      openRequestIds.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.user-input.respond.failed" &&
      detail !== null &&
      (detail.includes("stale pending user-input request") ||
        detail.includes("unknown pending user-input request") ||
        detail.includes("unknown pending user input request") ||
        detail.includes("unknown pending codex user input request"))
    ) {
      openRequestIds.delete(requestId);
    }
  }

  return openRequestIds.size;
}

function retainProjectionMessagesAfterRevert(
  messages: ReadonlyArray<ProjectionThreadMessage>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionThreadMessage> {
  const retainedMessageIds = new Set<string>();
  const retainedTurnIds = new Set<string>();
  const keptTurns = turns.filter(
    (turn) =>
      turn.turnId !== null &&
      turn.checkpointTurnCount !== null &&
      turn.checkpointTurnCount <= turnCount,
  );
  for (const turn of keptTurns) {
    if (turn.turnId !== null) {
      retainedTurnIds.add(turn.turnId);
    }
    if (turn.pendingMessageId !== null) {
      retainedMessageIds.add(turn.pendingMessageId);
    }
    if (turn.assistantMessageId !== null) {
      retainedMessageIds.add(turn.assistantMessageId);
    }
  }

  for (const message of messages) {
    if (message.role === "system" || isImportedAgentSessionMessageId(message.messageId)) {
      retainedMessageIds.add(message.messageId);
      continue;
    }
    if (message.turnId !== null && retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(message.messageId);
    }
  }

  const retainedUserCount = messages.filter(
    (message) =>
      message.role === "user" &&
      !isImportedAgentSessionMessageId(message.messageId) &&
      retainedMessageIds.has(message.messageId),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(message.messageId) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          compareDateTimeStrings(left.createdAt, right.createdAt) ||
          left.messageId.localeCompare(right.messageId),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.messageId);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) =>
      message.role === "assistant" &&
      !isImportedAgentSessionMessageId(message.messageId) &&
      retainedMessageIds.has(message.messageId),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(message.messageId) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          compareDateTimeStrings(left.createdAt, right.createdAt) ||
          left.messageId.localeCompare(right.messageId),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.messageId);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.messageId));
}

function retainProjectionActivitiesAfterRevert(
  activities: ReadonlyArray<ProjectionThreadActivity>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionThreadActivity> {
  const retainedTurnIds = new Set<string>(
    turns
      .filter(
        (turn) =>
          turn.turnId !== null &&
          turn.checkpointTurnCount !== null &&
          turn.checkpointTurnCount <= turnCount,
      )
      .flatMap((turn) => (turn.turnId === null ? [] : [turn.turnId])),
  );
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

function retainProjectionProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<ProjectionThreadProposedPlan>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionThreadProposedPlan> {
  const retainedTurnIds = new Set<string>(
    turns
      .filter(
        (turn) =>
          turn.turnId !== null &&
          turn.checkpointTurnCount !== null &&
          turn.checkpointTurnCount <= turnCount,
      )
      .flatMap((turn) => (turn.turnId === null ? [] : [turn.turnId])),
  );
  return proposedPlans.filter(
    (proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId),
  );
}

const decodeQuestionAttachmentAnswer = Schema.decodeUnknownOption(UserInputAttachmentAnswerPayload);

function collectThreadAttachmentRelativePaths(
  threadId: string,
  messages: ReadonlyArray<ProjectionThreadMessage>,
): Set<string> {
  const threadSegment = toSafeThreadAttachmentSegment(threadId);
  if (!threadSegment) {
    return new Set();
  }
  const relativePaths = new Set<string>();
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachment.id);
      if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) {
        continue;
      }
      const relativePath = attachmentRelativePath(attachment);
      if (relativePath) {
        relativePaths.add(relativePath);
      }
    }
  }
  return relativePaths;
}

const runAttachmentSideEffects = Effect.fn("runAttachmentSideEffects")(function* (
  sideEffects: AttachmentSideEffects,
) {
  const serverConfig = yield* Effect.service(ServerConfig);
  const fileSystem = yield* Effect.service(FileSystem.FileSystem);
  const path = yield* Effect.service(Path.Path);

  const attachmentsRootDir = serverConfig.attachmentsDir;
  const readAttachmentRootEntries = fileSystem.readDirectory(attachmentsRootDir, {
    recursive: false,
  });

  const removeDeletedThreadAttachmentEntry = Effect.fn("removeDeletedThreadAttachmentEntry")(
    function* (threadSegment: string, entry: string) {
      const normalizedEntry = entry.replace(/^[/\\]+/, "").replace(/\\/g, "/");
      if (normalizedEntry.length === 0 || normalizedEntry.includes("/")) {
        return;
      }
      const attachmentId = parseAttachmentIdFromRelativePath(normalizedEntry);
      if (!attachmentId) {
        return;
      }
      const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachmentId);
      if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) {
        return;
      }
      yield* fileSystem.remove(path.join(attachmentsRootDir, normalizedEntry), {
        force: true,
      });
    },
  );

  const deleteThreadAttachments = Effect.fn("deleteThreadAttachments")(function* (
    threadId: string,
  ) {
    const threadSegment = toSafeThreadAttachmentSegment(threadId);
    if (!threadSegment) {
      yield* Effect.logWarning("skipping attachment cleanup for unsafe thread id", {
        threadId,
      });
      return;
    }

    const entries = yield* readAttachmentRootEntries;
    yield* Effect.forEach(
      entries,
      (entry) => removeDeletedThreadAttachmentEntry(threadSegment, entry),
      {
        concurrency: 1,
      },
    );
  });

  const pruneThreadAttachmentEntry = Effect.fn("pruneThreadAttachmentEntry")(function* (
    threadSegment: string,
    keptThreadRelativePaths: Set<string>,
    entry: string,
  ) {
    const relativePath = entry.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    if (relativePath.length === 0 || relativePath.includes("/")) {
      return;
    }
    const attachmentId = parseAttachmentIdFromRelativePath(relativePath);
    if (!attachmentId) {
      return;
    }
    const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachmentId);
    if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) {
      return;
    }

    const absolutePath = path.join(attachmentsRootDir, relativePath);
    const fileInfo = yield* fileSystem.stat(absolutePath);
    if (!fileInfo || fileInfo.type !== "File") {
      return;
    }

    if (!keptThreadRelativePaths.has(relativePath)) {
      yield* fileSystem.remove(absolutePath, { force: true });
    }
  });

  const pruneThreadAttachments = Effect.fn("pruneThreadAttachments")(function* (
    threadId: string,
    keptThreadRelativePaths: Set<string>,
  ) {
    if (sideEffects.deletedThreadIds.has(threadId)) {
      return;
    }

    const threadSegment = toSafeThreadAttachmentSegment(threadId);
    if (!threadSegment) {
      yield* Effect.logWarning("skipping attachment prune for unsafe thread id", { threadId });
      return;
    }

    const entries = yield* readAttachmentRootEntries;
    yield* Effect.forEach(
      entries,
      (entry) => pruneThreadAttachmentEntry(threadSegment, keptThreadRelativePaths, entry),
      { concurrency: 1 },
    );
  });

  yield* Effect.forEach(sideEffects.deletedThreadIds, deleteThreadAttachments, {
    concurrency: 1,
  });

  yield* Effect.forEach(
    sideEffects.prunedThreadRelativePaths.entries(),
    ([threadId, keptThreadRelativePaths]) =>
      pruneThreadAttachments(threadId, keptThreadRelativePaths),
    { concurrency: 1 },
  );
});

const makeOrchestrationProjectionPipeline = Effect.fn("makeOrchestrationProjectionPipeline")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    const eventStore = yield* OrchestrationEventStore;
    const projectionStateRepository = yield* ProjectionStateRepository;
    const projectionDecoderRepository = yield* ProjectionDecoderRepository;
    const projectionProjectRepository = yield* ProjectionProjectRepository;
    const projectionChannelRepository = yield* ProjectionChannelRepository;
    const projectionThreadRepository = yield* ProjectionThreadRepository;
    const projectionThreadMessageRepository = yield* ProjectionThreadMessageRepository;
    const projectionThreadProposedPlanRepository = yield* ProjectionThreadProposedPlanRepository;
    const projectionThreadPullRequestRepository =
      yield* ProjectionThreadPullRequests.ProjectionThreadPullRequestRepository;
    const projectionThreadActivityRepository = yield* ProjectionThreadActivityRepository;
    const projectionThreadSessionRepository = yield* ProjectionThreadSessionRepository;
    const projectionTurnRepository = yield* ProjectionTurnRepository;
    const projectionPendingApprovalRepository = yield* ProjectionPendingApprovalRepository;
    const channelPostWakeRepository = yield* ChannelPostWakeRepository;

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverConfig = yield* ServerConfig;

    const applyChannelsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyChannelsProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "channel.created":
          yield* projectionChannelRepository.upsertChannel({
            channelId: event.payload.channelId,
            name: event.payload.name,
            members: event.payload.members,
            archivedAt: null,
            createdAt: event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
          });
          return;

        case "channel.meta-updated":
        case "channel.archived":
        case "channel.unarchived": {
          const existing = yield* projectionChannelRepository.getChannelById(
            event.payload.channelId,
          );
          if (Option.isNone(existing)) {
            return;
          }
          yield* projectionChannelRepository.upsertChannel({
            ...existing.value,
            ...(event.type === "channel.meta-updated" && event.payload.name !== undefined
              ? { name: event.payload.name }
              : {}),
            ...(event.type === "channel.archived"
              ? { archivedAt: event.payload.archivedAt }
              : event.type === "channel.unarchived"
                ? { archivedAt: null }
                : {}),
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "channel.member-added":
        case "channel.member-removed":
        case "channel.member-renamed": {
          const existing = yield* projectionChannelRepository.getChannelById(
            event.payload.channelId,
          );
          if (Option.isNone(existing)) {
            return;
          }
          // A rename is the row under its new handle, not a removal and an add:
          // `replaceMembers` rewrites the whole roster inside this event's
          // transaction, so no reader sees the member absent in between.
          const members =
            event.type === "channel.member-added"
              ? [
                  ...existing.value.members.filter(
                    (member) => member.handle !== event.payload.member.handle,
                  ),
                  event.payload.member,
                ]
              : event.type === "channel.member-renamed"
                ? existing.value.members.map((member) =>
                    member.handle === event.payload.from
                      ? { ...member, handle: event.payload.to }
                      : member,
                  )
                : existing.value.members.filter((member) => member.handle !== event.payload.handle);
          yield* projectionChannelRepository.replaceMembers({
            channelId: event.payload.channelId,
            members,
          });
          return;
        }

        case "channel.post-created":
          yield* projectionChannelRepository.insertPost({
            postId: event.payload.postId,
            channelId: event.payload.channelId,
            // The event sequence is the channel's post order and the cursor.
            sequence: event.sequence,
            authorHandle: event.payload.authorHandle,
            body: event.payload.body,
            mentions: event.payload.mentions,
            parentPostId: event.payload.parentPostId,
            createdAt: event.payload.createdAt,
          });
          return;

        default:
          return;
      }
    });

    const applyProjectsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyProjectsProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "project.created":
          yield* projectionProjectRepository.upsert({
            projectId: event.payload.projectId,
            title: event.payload.title,
            workspaceRoot: event.payload.workspaceRoot,
            defaultModelSelection: event.payload.defaultModelSelection,
            defaultThreadEnvMode: null,
            autoPull: false,
            faviconPath: event.payload.faviconPath ?? null,
            projectIcon: event.payload.projectIcon ?? null,
            scripts: event.payload.scripts,
            createdAt: event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
            deletedAt: null,
          });
          return;

        case "project.meta-updated": {
          const existingRow = yield* projectionProjectRepository.getById({
            projectId: event.payload.projectId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionProjectRepository.upsert({
            ...existingRow.value,
            ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
            ...(event.payload.workspaceRoot !== undefined
              ? { workspaceRoot: event.payload.workspaceRoot }
              : {}),
            ...(event.payload.defaultModelSelection !== undefined
              ? { defaultModelSelection: event.payload.defaultModelSelection }
              : {}),
            ...(event.payload.defaultThreadEnvMode !== undefined
              ? { defaultThreadEnvMode: event.payload.defaultThreadEnvMode }
              : {}),
            ...(event.payload.autoPull !== undefined ? { autoPull: event.payload.autoPull } : {}),
            ...(event.payload.faviconPath !== undefined
              ? { faviconPath: event.payload.faviconPath }
              : {}),
            ...(event.payload.projectIcon !== undefined
              ? { projectIcon: event.payload.projectIcon }
              : {}),
            ...(event.payload.scripts !== undefined ? { scripts: event.payload.scripts } : {}),
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "project.deleted": {
          const existingRow = yield* projectionProjectRepository.getById({
            projectId: event.payload.projectId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionProjectRepository.upsert({
            ...existingRow.value,
            deletedAt: event.payload.deletedAt,
            updatedAt: event.payload.deletedAt,
          });
          return;
        }

        default:
          return;
      }
    });

    const refreshThreadShellSummary = Effect.fn("refreshThreadShellSummary")(function* (
      threadId: ThreadId,
    ) {
      const existingRow = yield* projectionThreadRepository.getById({
        threadId,
      });
      if (Option.isNone(existingRow)) {
        return;
      }

      const [latestUserMessageAt, hasActionableProposedPlan, activities, pendingApprovalCount] =
        yield* Effect.all([
          projectionThreadMessageRepository.getLatestUserMessageAt({ threadId }),
          projectionThreadProposedPlanRepository.hasActionableByThreadId({
            threadId,
            latestTurnId: existingRow.value.latestTurnId,
          }),
          projectionThreadActivityRepository.listUserInputLifecycleByThreadId({ threadId }),
          projectionPendingApprovalRepository.countPendingByThreadId({ threadId }),
        ]);

      const pendingUserInputCount = derivePendingUserInputCountFromActivities(activities);

      yield* projectionThreadRepository.upsert({
        ...existingRow.value,
        latestUserMessageAt,
        pendingApprovalCount,
        pendingUserInputCount,
        hasActionableProposedPlan: hasActionableProposedPlan ? 1 : 0,
      });
    });

    const applyThreadsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadsProjection",
    )(function* (event, attachmentSideEffects) {
      switch (event.type) {
        case "thread.created":
          // A draft retry can re-create this id; links belong to the old incarnation.
          yield* projectionThreadPullRequestRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          yield* projectionThreadRepository.upsert({
            threadId: event.payload.threadId,
            projectId: event.payload.projectId,
            title: event.payload.title,
            modelSelection: event.payload.modelSelection,
            runtimeMode: event.payload.runtimeMode,
            interactionMode: event.payload.interactionMode,
            branch: event.payload.branch,
            worktreePath: event.payload.worktreePath,
            linkedPullRequest: null,
            branchPullRequest: null,
            latestTurnId: null,
            createdAt: event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            unsettledAt: null,
            snoozedUntil: null,
            snoozedAt: null,
            pinnedAt: null,
            pinOrderKey: null,
            activeOrderKey: null,
            titleRegenerationRequestId: null,
            titleRegenerationStartedAt: null,
            latestUserMessageAt: null,
            pendingApprovalCount: 0,
            pendingUserInputCount: 0,
            hasActionableProposedPlan: 0,
            deletedAt: null,
          });
          return;

        case "thread.archived": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            archivedAt: event.payload.archivedAt,
            titleRegenerationRequestId: null,
            titleRegenerationStartedAt: null,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.unarchived": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            archivedAt: null,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.settled": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            settledOverride: "settled",
            settledAt: event.payload.settledAt,
            unsettledAt: null,
            activeOrderKey: null,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.unsettled": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            settledOverride: event.payload.reason === "user" ? "active" : null,
            settledAt: null,
            // Re-entry stamp for active-list ordering. A thread already pinned
            // active keeps its stamp: the activity reset that clears the pin
            // is not a re-entry and must not reorder the list.
            unsettledAt:
              existingRow.value.settledOverride === "active"
                ? existingRow.value.unsettledAt
                : event.payload.updatedAt,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.snoozed": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            snoozedUntil: event.payload.snoozedUntil,
            snoozedAt: event.payload.snoozedAt,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.unsnoozed": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            snoozedUntil: null,
            snoozedAt: null,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.pinned": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            pinnedAt: event.payload.pinnedAt,
            ...(event.payload.pinOrderKey !== undefined
              ? { pinOrderKey: event.payload.pinOrderKey }
              : {}),
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.unpinned": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            pinnedAt: null,
            pinOrderKey: null,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.pin-reordered": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            pinOrderKey: event.payload.orderKey,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.meta-updated": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
            ...(event.payload.activeOrderKey !== undefined
              ? { activeOrderKey: event.payload.activeOrderKey }
              : {}),
            ...(event.payload.titleRegeneration !== undefined
              ? {
                  titleRegenerationRequestId: event.payload.titleRegeneration?.requestId ?? null,
                  titleRegenerationStartedAt: event.payload.titleRegeneration?.startedAt ?? null,
                }
              : {}),
            ...(event.payload.modelSelection !== undefined
              ? { modelSelection: event.payload.modelSelection }
              : {}),
            ...(event.payload.branch !== undefined ? { branch: event.payload.branch } : {}),
            ...(event.payload.worktreePath !== undefined
              ? { worktreePath: event.payload.worktreePath }
              : {}),
            ...(event.payload.linkedPullRequest !== undefined
              ? { linkedPullRequest: event.payload.linkedPullRequest }
              : {}),
            ...(event.payload.branchPullRequest !== undefined
              ? { branchPullRequest: event.payload.branchPullRequest }
              : {}),
            updatedAt: event.payload.updatedAt,
          });
          // Legacy single-link events replay into the link table. The old
          // field held one user-chosen link, so it only ever owns the manual
          // rows; created/agent/stack links are left alone.
          if (event.payload.linkedPullRequest !== undefined) {
            yield* projectionThreadPullRequestRepository.deleteByThreadIdAndSource({
              threadId: event.payload.threadId,
              source: "manual",
            });
            if (event.payload.linkedPullRequest !== null) {
              const linked = event.payload.linkedPullRequest;
              yield* projectionThreadPullRequestRepository.upsert({
                threadId: event.payload.threadId,
                ...legacyThreadPullRequestKey(linked),
                url: linked.url,
                source: "manual",
                linkedAt: event.payload.updatedAt,
                snapshot: null,
                stack: null,
              });
            }
          }
          return;
        }

        case "thread.pull-request-linked": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadPullRequestRepository.upsert({
            threadId: event.payload.threadId,
            ...event.payload.link,
          });
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.pull-request-unlinked": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadPullRequestRepository.delete({
            threadId: event.payload.threadId,
            host: event.payload.host.toLowerCase(),
            repository: event.payload.repository.toLowerCase(),
            number: event.payload.number,
          });
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.pull-request-synced": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          // A sync for a link the user removed in the meantime is stale; drop it.
          const links = yield* projectionThreadPullRequestRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const link = links.find((candidate) =>
            threadPullRequestKeysEqual(candidate, event.payload),
          );
          if (link === undefined) {
            return;
          }
          yield* projectionThreadPullRequestRepository.upsert({
            ...link,
            snapshot: event.payload.snapshot,
            stack: event.payload.stack,
          });
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.runtime-mode-set": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            runtimeMode: event.payload.runtimeMode,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.interaction-mode-set": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            interactionMode: event.payload.interactionMode,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.deleted": {
          // A draft retry can re-create this id later in the log. During
          // replay the attachment files on disk already belong to that later
          // incarnation, so only an unsuperseded deletion removes them.
          const recreatedLater = yield* eventStore.hasEventAfter({
            aggregateKind: "thread",
            aggregateId: event.payload.threadId,
            type: "thread.created",
            sequenceExclusive: event.sequence,
          });
          if (!recreatedLater) {
            attachmentSideEffects.deletedThreadIds.add(event.payload.threadId);
          }
          // A tombstoned thread must not show up as linked to a pull request.
          yield* projectionThreadPullRequestRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            deletedAt: event.payload.deletedAt,
            updatedAt: event.payload.deletedAt,
          });
          return;
        }

        // A message cannot change any summary field except latestUserMessageAt,
        // which is a monotonic maximum that folds in directly. The full refresh
        // would re-read every message body in the thread per user message.
        case "thread.message-sent": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          const previousLatest = existingRow.value.latestUserMessageAt;
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            updatedAt: event.occurredAt,
            latestUserMessageAt:
              event.payload.role === "user" &&
              !isImportedAgentSessionMessageId(event.payload.messageId) &&
              (previousLatest === null || event.payload.createdAt > previousLatest)
                ? event.payload.createdAt
                : previousLatest,
          });
          return;
        }

        case "thread.proposed-plan-upserted":
        case "thread.activity-appended":
        case "thread.approval-response-requested":
        case "thread.user-input-response-requested": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            updatedAt: event.occurredAt,
          });
          if (shouldRefreshThreadShellSummary(event)) {
            yield* refreshThreadShellSummary(event.payload.threadId);
          }
          return;
        }

        case "thread.session-set": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            // activeTurnId describes current work; a terminal session must not erase history.
            latestTurnId: event.payload.session.activeTurnId ?? existingRow.value.latestTurnId,
            updatedAt: event.occurredAt,
          });
          yield* refreshThreadShellSummary(event.payload.threadId);
          return;
        }

        case "thread.turn-diff-completed": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            latestTurnId: event.payload.turnId,
            updatedAt: event.occurredAt,
          });
          yield* refreshThreadShellSummary(event.payload.threadId);
          return;
        }

        case "thread.reverted": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }

          const retainedTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          let latestTurnId: ProjectionTurn["turnId"] = null;
          let latestCheckpointTurnCount = -1;
          for (let index = 0; index < retainedTurns.length; index += 1) {
            const turn = retainedTurns[index];
            if (
              !turn ||
              turn.turnId === null ||
              turn.checkpointTurnCount === null ||
              turn.checkpointTurnCount > event.payload.turnCount
            ) {
              continue;
            }
            if (turn.checkpointTurnCount > latestCheckpointTurnCount) {
              latestCheckpointTurnCount = turn.checkpointTurnCount;
              latestTurnId = turn.turnId;
            }
          }

          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            latestTurnId,
            updatedAt: event.occurredAt,
          });
          yield* refreshThreadShellSummary(event.payload.threadId);
          return;
        }

        default:
          return;
      }
    });

    const applyThreadMessagesProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadMessagesProjection",
    )(function* (event, attachmentSideEffects) {
      switch (event.type) {
        // A draft retry re-creates a soft-deleted thread id. Every projector
        // drops its own rows for the old incarnation here so replay from any
        // per-projector cursor rebuilds the new thread without stale history.
        case "thread.created":
          yield* projectionThreadMessageRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          return;

        case "thread.message-sent": {
          if (event.payload.streaming) {
            const attachments =
              event.payload.attachments !== undefined
                ? yield* materializeAttachmentsForProjection({
                    attachments: event.payload.attachments,
                  })
                : undefined;
            yield* projectionThreadMessageRepository.appendStreaming({
              messageId: event.payload.messageId,
              threadId: event.payload.threadId,
              turnId: event.payload.turnId,
              role: event.payload.role,
              text: event.payload.text,
              ...(attachments !== undefined ? { attachments: [...attachments] } : {}),
              createdAt: event.payload.createdAt,
              updatedAt: event.payload.updatedAt,
            });
            return;
          }

          const existingMessage = yield* projectionThreadMessageRepository.getByMessageId({
            messageId: event.payload.messageId,
          });
          const previousMessage = Option.getOrUndefined(existingMessage);
          const nextText = Option.match(existingMessage, {
            onNone: () => event.payload.text,
            onSome: (message) =>
              event.payload.text.length === 0 ? message.text : event.payload.text,
          });
          const nextAttachments =
            event.payload.attachments !== undefined
              ? yield* materializeAttachmentsForProjection({
                  attachments: event.payload.attachments,
                })
              : previousMessage?.attachments;
          yield* projectionThreadMessageRepository.upsert({
            messageId: event.payload.messageId,
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
            role: event.payload.role,
            text: nextText,
            ...(nextAttachments !== undefined ? { attachments: [...nextAttachments] } : {}),
            isStreaming: false,
            createdAt: previousMessage?.createdAt ?? event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.reverted": {
          const existingRows = yield* projectionThreadMessageRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          if (existingRows.length === 0) {
            return;
          }

          const existingTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptRows = retainProjectionMessagesAfterRevert(
            existingRows,
            existingTurns,
            event.payload.turnCount,
          );
          if (keptRows.length === existingRows.length) {
            return;
          }

          yield* projectionThreadMessageRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(keptRows, projectionThreadMessageRepository.upsert, {
            concurrency: 1,
          }).pipe(Effect.asVoid);
          attachmentSideEffects.prunedThreadRelativePaths.set(
            event.payload.threadId,
            collectThreadAttachmentRelativePaths(event.payload.threadId, keptRows),
          );
          return;
        }

        default:
          return;
      }
    });

    const applyThreadProposedPlansProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadProposedPlansProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "thread.created":
          yield* projectionThreadProposedPlanRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          return;

        case "thread.proposed-plan-upserted":
          yield* projectionThreadProposedPlanRepository.upsert({
            planId: event.payload.proposedPlan.id,
            threadId: event.payload.threadId,
            turnId: event.payload.proposedPlan.turnId,
            planMarkdown: event.payload.proposedPlan.planMarkdown,
            implementedAt: event.payload.proposedPlan.implementedAt,
            implementationThreadId: event.payload.proposedPlan.implementationThreadId,
            createdAt: event.payload.proposedPlan.createdAt,
            updatedAt: event.payload.proposedPlan.updatedAt,
          });
          return;

        case "thread.reverted": {
          const existingRows = yield* projectionThreadProposedPlanRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          if (existingRows.length === 0) {
            return;
          }

          const existingTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptRows = retainProjectionProposedPlansAfterRevert(
            existingRows,
            existingTurns,
            event.payload.turnCount,
          );
          if (keptRows.length === existingRows.length) {
            return;
          }

          yield* projectionThreadProposedPlanRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(keptRows, projectionThreadProposedPlanRepository.upsert, {
            concurrency: 1,
          }).pipe(Effect.asVoid);
          return;
        }

        default:
          return;
      }
    });

    const applyThreadActivitiesProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadActivitiesProjection",
    )(function* (event, attachmentSideEffects) {
      switch (event.type) {
        case "thread.created":
          yield* projectionThreadActivityRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          return;

        case "thread.activity-appended":
          yield* projectionThreadActivityRepository.upsert({
            activityId: event.payload.activity.id,
            threadId: event.payload.threadId,
            turnId: event.payload.activity.turnId,
            tone: event.payload.activity.tone,
            kind: event.payload.activity.kind,
            summary: event.payload.activity.summary,
            payload: event.payload.activity.payload,
            ...(event.payload.activity.sequence !== undefined
              ? { sequence: event.payload.activity.sequence }
              : {}),
            createdAt: event.payload.activity.createdAt,
          });
          return;

        case "thread.reverted": {
          const existingRows = yield* projectionThreadActivityRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          if (existingRows.length === 0) {
            return;
          }
          const existingTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptRows = retainProjectionActivitiesAfterRevert(
            existingRows,
            existingTurns,
            event.payload.turnCount,
          );
          if (keptRows.length === existingRows.length) {
            return;
          }
          yield* projectionThreadActivityRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(keptRows, projectionThreadActivityRepository.upsert, {
            concurrency: 1,
          }).pipe(Effect.asVoid);
          attachmentSideEffects.prunedThreadRelativePaths.set(event.payload.threadId, new Set());
          return;
        }

        default:
          return;
      }
    });

    const applyThreadSessionsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadSessionsProjection",
    )(function* (event, _attachmentSideEffects) {
      if (event.type === "thread.created") {
        yield* projectionThreadSessionRepository.deleteByThreadId({
          threadId: event.payload.threadId,
        });
        return;
      }
      if (event.type !== "thread.session-set") {
        return;
      }
      yield* projectionThreadSessionRepository.upsert({
        threadId: event.payload.threadId,
        status: event.payload.session.status,
        providerName: event.payload.session.providerName,
        providerInstanceId: event.payload.session.providerInstanceId ?? null,
        runtimeMode: event.payload.session.runtimeMode,
        activeTurnId: event.payload.session.activeTurnId,
        lastError: event.payload.session.lastError,
        updatedAt: event.payload.session.updatedAt,
      });
    });

    const applyThreadTurnsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadTurnsProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "thread.created":
          yield* projectionTurnRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          return;

        case "thread.turn-start-requested": {
          const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({
            threadId: event.payload.threadId,
          });
          if (Option.isSome(pendingTurnStart)) {
            const pendingMessage = yield* projectionThreadMessageRepository.getByMessageId({
              messageId: pendingTurnStart.value.messageId,
            });
            if (
              Option.isSome(pendingMessage) &&
              pendingMessage.value.role === "user" &&
              (pendingMessage.value.attachments?.length ?? 0) === 0 &&
              pendingMessage.value.text.trim().toLowerCase() === "/compact"
            ) {
              return;
            }
          }
          yield* projectionTurnRepository.replacePendingTurnStart({
            threadId: event.payload.threadId,
            messageId: event.payload.messageId,
            sourceProposedPlanThreadId: event.payload.sourceProposedPlan?.threadId ?? null,
            sourceProposedPlanId: event.payload.sourceProposedPlan?.planId ?? null,
            requestedAt: event.payload.createdAt,
          });
          return;
        }

        case "thread.activity-appended": {
          if (event.payload.activity.kind === "context-compaction") {
            const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId(
              event.payload,
            );
            if (
              Option.isNone(pendingTurnStart) ||
              String(pendingTurnStart.value.messageId) !==
                extractActivityRequestId(event.payload.activity.payload)
            ) {
              return;
            }
            yield* projectionTurnRepository.deletePendingTurnStartByThreadId(event.payload);
            return;
          }
          if (event.payload.activity.kind !== "provider.turn.start.failed") return;
          const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId(
            event.payload,
          );
          if (
            Option.isNone(pendingTurnStart) ||
            String(pendingTurnStart.value.messageId) !==
              extractActivityRequestId(event.payload.activity.payload)
          ) {
            return;
          }
          yield* projectionTurnRepository.deletePendingTurnStartByThreadId(event.payload);
          return;
        }

        case "thread.session-set": {
          const turnId = event.payload.session.activeTurnId;
          if (turnId === null || event.payload.session.status !== "running") {
            if (
              (event.payload.session.status === "ready" &&
                event.commandId?.startsWith("server:provider-session-set:") === true) ||
              event.payload.session.status === "error" ||
              event.payload.session.status === "stopped" ||
              event.payload.session.status === "interrupted"
            ) {
              yield* projectionTurnRepository.deletePendingTurnStartByThreadId({
                threadId: event.payload.threadId,
              });
            }
            // Leaving the "running" session status is the turn-end signal:
            // settle still-running turns so their duration reflects the whole
            // turn rather than the last assistant message.
            const settledTurnState = settledTurnStateForSessionStatus(event.payload.session.status);
            if (settledTurnState === null) {
              return;
            }
            const existingTurns = yield* projectionTurnRepository.listByThreadId({
              threadId: event.payload.threadId,
            });
            yield* Effect.forEach(
              existingTurns.filter((turn) => turn.turnId !== null && turn.state === "running"),
              (turn) =>
                turn.turnId === null
                  ? Effect.void
                  : projectionTurnRepository.upsertByTurnId({
                      ...turn,
                      turnId: turn.turnId,
                      state: settledTurnState,
                      // A running turn's completedAt can only hold a mid-turn
                      // placeholder checkpoint timestamp — the session leaving
                      // "running" is the authoritative turn end.
                      completedAt: event.payload.session.updatedAt,
                    }),
              { concurrency: 1 },
            );
            return;
          }

          // A new active turn supersedes any still-running turn on the same
          // thread — steering can open a new turn without the provider ever
          // completing the previous one.
          const otherRunningTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(
            otherRunningTurns.filter(
              (turn) => turn.turnId !== null && turn.turnId !== turnId && turn.state === "running",
            ),
            (turn) =>
              turn.turnId === null
                ? Effect.void
                : projectionTurnRepository.upsertByTurnId({
                    ...turn,
                    turnId: turn.turnId,
                    state: "completed",
                    completedAt: event.payload.session.updatedAt,
                  }),
            { concurrency: 1 },
          );

          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            threadId: event.payload.threadId,
            turnId,
          });
          const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({
            threadId: event.payload.threadId,
          });
          if (Option.isSome(existingTurn)) {
            const nextState =
              existingTurn.value.state === "completed" || existingTurn.value.state === "error"
                ? existingTurn.value.state
                : "running";
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              state: nextState,
              pendingMessageId:
                existingTurn.value.pendingMessageId ??
                (Option.isSome(pendingTurnStart) ? pendingTurnStart.value.messageId : null),
              sourceProposedPlanThreadId:
                existingTurn.value.sourceProposedPlanThreadId ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.sourceProposedPlanThreadId
                  : null),
              sourceProposedPlanId:
                existingTurn.value.sourceProposedPlanId ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.sourceProposedPlanId
                  : null),
              startedAt:
                existingTurn.value.startedAt ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.requestedAt
                  : event.occurredAt),
              requestedAt:
                existingTurn.value.requestedAt ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.requestedAt
                  : event.occurredAt),
            });
          } else {
            yield* projectionTurnRepository.upsertByTurnId({
              turnId,
              threadId: event.payload.threadId,
              pendingMessageId: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.messageId
                : null,
              sourceProposedPlanThreadId: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.sourceProposedPlanThreadId
                : null,
              sourceProposedPlanId: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.sourceProposedPlanId
                : null,
              assistantMessageId: null,
              state: "running",
              requestedAt: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.requestedAt
                : event.occurredAt,
              startedAt: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.requestedAt
                : event.occurredAt,
              completedAt: null,
              checkpointTurnCount: null,
              checkpointRef: null,
              checkpointStatus: null,
              checkpointFiles: [],
            });
          }

          // THE POST-TO-TURN LINK IS CAPTURED HERE, BEFORE THE DELETE BELOW
          // DESTROYS IT, and this is the only place it can be. The staging row
          // holds the post-derived key and the session-set carries the turn id;
          // one line later the staging row is gone, and the turn row took the
          // key only if it had none — the `??` above — so on a running thread
          // every post after the first is about to have its key nowhere
          // (`t3_bot-j6o`, measured in `MentionWakeReactor.test.ts`).
          //
          // ONLY A WAKE'S KEY. Every ordinary user turn stages a row too, under
          // a plain message id; `parseWakeKey` answers `None` for those and
          // they are not this table's business.
          //
          // IN THE SAME TRANSACTION AS THE DELETE, without doing anything: every
          // projector `apply` runs inside `sql.withTransaction`
          // (`runProjectorForEvent`), so the link and the delete commit
          // together or not at all. A crash between them cannot leave the key
          // destroyed and uncaptured.
          if (Option.isSome(pendingTurnStart)) {
            const wake = parseWakeKey(String(pendingTurnStart.value.messageId));
            if (Option.isSome(wake)) {
              yield* channelPostWakeRepository.link({
                channelId: wake.value.channelId,
                postId: wake.value.postId,
                threadId: wake.value.threadId,
                turnId,
                linkedAt: event.payload.session.updatedAt,
              });
            }
          }

          yield* projectionTurnRepository.deletePendingTurnStartByThreadId({
            threadId: event.payload.threadId,
          });
          return;
        }

        case "thread.message-sent": {
          if (event.payload.turnId === null || event.payload.role !== "assistant") {
            return;
          }
          // A completed assistant message only settles the turn once the
          // session is no longer running it — providers may emit several
          // assistant messages per turn (commentary between tool calls), and
          // the turn must stay unsettled until the provider reports turn end
          // (projected as thread.session-set leaving the "running" status).
          const session = yield* projectionThreadSessionRepository.getByThreadId({
            threadId: event.payload.threadId,
          });
          const turnStillRunning =
            Option.isSome(session) &&
            session.value.status === "running" &&
            session.value.activeTurnId === event.payload.turnId;
          const settlesTurn = !event.payload.streaming && !turnStillRunning;
          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
          });
          if (Option.isSome(existingTurn)) {
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              assistantMessageId: event.payload.messageId,
              state: settlesTurn
                ? existingTurn.value.state === "interrupted"
                  ? "interrupted"
                  : existingTurn.value.state === "error"
                    ? "error"
                    : "completed"
                : existingTurn.value.state,
              completedAt: settlesTurn
                ? (existingTurn.value.completedAt ?? event.payload.updatedAt)
                : existingTurn.value.completedAt,
              startedAt: existingTurn.value.startedAt ?? event.payload.createdAt,
              requestedAt: existingTurn.value.requestedAt ?? event.payload.createdAt,
            });
            return;
          }
          yield* projectionTurnRepository.upsertByTurnId({
            turnId: event.payload.turnId,
            threadId: event.payload.threadId,
            pendingMessageId: null,
            sourceProposedPlanThreadId: null,
            sourceProposedPlanId: null,
            assistantMessageId: event.payload.messageId,
            state: settlesTurn ? "completed" : "running",
            requestedAt: event.payload.createdAt,
            startedAt: event.payload.createdAt,
            completedAt: settlesTurn ? event.payload.updatedAt : null,
            checkpointTurnCount: null,
            checkpointRef: null,
            checkpointStatus: null,
            checkpointFiles: [],
          });
          return;
        }

        case "thread.turn-interrupt-requested": {
          if (event.payload.turnId === undefined) {
            return;
          }
          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
          });
          if (Option.isSome(existingTurn)) {
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              state: "interrupted",
              completedAt: existingTurn.value.completedAt ?? event.payload.createdAt,
              startedAt: existingTurn.value.startedAt ?? event.payload.createdAt,
              requestedAt: existingTurn.value.requestedAt ?? event.payload.createdAt,
            });
            return;
          }
          yield* projectionTurnRepository.upsertByTurnId({
            turnId: event.payload.turnId,
            threadId: event.payload.threadId,
            pendingMessageId: null,
            sourceProposedPlanThreadId: null,
            sourceProposedPlanId: null,
            assistantMessageId: null,
            state: "interrupted",
            requestedAt: event.payload.createdAt,
            startedAt: event.payload.createdAt,
            completedAt: event.payload.createdAt,
            checkpointTurnCount: null,
            checkpointRef: null,
            checkpointStatus: null,
            checkpointFiles: [],
          });
          return;
        }

        case "thread.turn-diff-completed": {
          // Mid-turn diff updates produce placeholder checkpoints; record the
          // checkpoint, but don't settle a turn its session is still running.
          const session = yield* projectionThreadSessionRepository.getByThreadId({
            threadId: event.payload.threadId,
          });
          const turnStillRunning =
            Option.isSome(session) &&
            session.value.status === "running" &&
            session.value.activeTurnId === event.payload.turnId;
          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
          });
          const nextState = event.payload.status === "error" ? "error" : "completed";
          yield* projectionTurnRepository.clearCheckpointTurnConflict({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
            checkpointTurnCount: event.payload.checkpointTurnCount,
          });

          if (Option.isSome(existingTurn)) {
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              assistantMessageId: event.payload.assistantMessageId,
              state:
                turnStillRunning || existingTurn.value.state === "interrupted"
                  ? existingTurn.value.state
                  : nextState,
              checkpointTurnCount: event.payload.checkpointTurnCount,
              checkpointRef: event.payload.checkpointRef,
              checkpointStatus: event.payload.status,
              checkpointFiles: event.payload.files,
              startedAt: existingTurn.value.startedAt ?? event.payload.completedAt,
              requestedAt: existingTurn.value.requestedAt ?? event.payload.completedAt,
              completedAt: event.payload.completedAt,
            });
            return;
          }
          yield* projectionTurnRepository.upsertByTurnId({
            turnId: event.payload.turnId,
            threadId: event.payload.threadId,
            pendingMessageId: null,
            sourceProposedPlanThreadId: null,
            sourceProposedPlanId: null,
            assistantMessageId: event.payload.assistantMessageId,
            state: turnStillRunning ? "running" : nextState,
            requestedAt: event.payload.completedAt,
            startedAt: event.payload.completedAt,
            completedAt: event.payload.completedAt,
            checkpointTurnCount: event.payload.checkpointTurnCount,
            checkpointRef: event.payload.checkpointRef,
            checkpointStatus: event.payload.status,
            checkpointFiles: event.payload.files,
          });
          return;
        }

        case "thread.reverted": {
          const existingTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptTurns = existingTurns.filter(
            (turn) =>
              turn.turnId !== null &&
              turn.checkpointTurnCount !== null &&
              turn.checkpointTurnCount <= event.payload.turnCount,
          );
          yield* projectionTurnRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(
            keptTurns,
            (turn) =>
              turn.turnId === null
                ? Effect.void
                : projectionTurnRepository.upsertByTurnId({
                    ...turn,
                    turnId: turn.turnId,
                  }),
            { concurrency: 1 },
          ).pipe(Effect.asVoid);
          return;
        }

        default:
          return;
      }
    });

    const applyCheckpointsProjection: ProjectorDefinition["apply"] = () => Effect.void;

    const applyPendingApprovalsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyPendingApprovalsProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "thread.created":
          yield* projectionPendingApprovalRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          return;

        case "thread.activity-appended": {
          const requestId =
            extractActivityRequestId(event.payload.activity.payload) ??
            event.metadata.requestId ??
            null;
          if (requestId === null) {
            return;
          }
          const existingRow = yield* projectionPendingApprovalRepository.getByRequestId({
            requestId,
          });
          if (event.payload.activity.kind === "approval.resolved") {
            const resolvedDecisionRaw =
              typeof event.payload.activity.payload === "object" &&
              event.payload.activity.payload !== null &&
              "decision" in event.payload.activity.payload
                ? (event.payload.activity.payload as { decision?: unknown }).decision
                : null;
            const resolvedDecision =
              resolvedDecisionRaw === "accept" ||
              resolvedDecisionRaw === "acceptForSession" ||
              resolvedDecisionRaw === "acceptAlways" ||
              resolvedDecisionRaw === "decline" ||
              resolvedDecisionRaw === "cancel"
                ? resolvedDecisionRaw
                : null;
            yield* projectionPendingApprovalRepository.upsert({
              requestId,
              threadId: Option.isSome(existingRow)
                ? existingRow.value.threadId
                : event.payload.threadId,
              turnId: Option.isSome(existingRow)
                ? existingRow.value.turnId
                : event.payload.activity.turnId,
              status: "resolved",
              decision: resolvedDecision,
              createdAt: Option.isSome(existingRow)
                ? existingRow.value.createdAt
                : event.payload.activity.createdAt,
              resolvedAt: event.payload.activity.createdAt,
            });
            return;
          }
          if (event.payload.activity.kind === "provider.approval.respond.failed") {
            const payload =
              typeof event.payload.activity.payload === "object" &&
              event.payload.activity.payload !== null
                ? (event.payload.activity.payload as Record<string, unknown>)
                : null;
            const detail =
              typeof payload?.detail === "string" ? payload.detail.toLowerCase() : null;
            if (isStalePendingApprovalFailureDetail(detail)) {
              if (Option.isNone(existingRow)) {
                return;
              }
              if (existingRow.value.status === "resolved") {
                return;
              }
              yield* projectionPendingApprovalRepository.upsert({
                requestId,
                threadId: existingRow.value.threadId,
                turnId: existingRow.value.turnId,
                status: "resolved",
                decision: null,
                createdAt: existingRow.value.createdAt,
                resolvedAt: event.payload.activity.createdAt,
              });
              return;
            }
            if (Option.isNone(existingRow) || existingRow.value.status !== "resolved") {
              return;
            }

            // Sending a reply clears the badge before the provider accepts it.
            // A failed reply must restore the request unless a terminal event
            // already closed it, including a reply from another client.
            const requestActivities = (yield* projectionThreadActivityRepository.listByThreadId({
              threadId: existingRow.value.threadId,
            })).filter((activity) => extractActivityRequestId(activity.payload) === requestId);
            const wasRequested = requestActivities.some(
              (activity) => activity.kind === "approval.requested",
            );
            const wasResolved = requestActivities.some((activity) => {
              if (activity.kind === "approval.resolved") {
                return true;
              }
              if (activity.kind !== "provider.approval.respond.failed") {
                return false;
              }
              const activityPayload =
                typeof activity.payload === "object" && activity.payload !== null
                  ? (activity.payload as Record<string, unknown>)
                  : null;
              return isStalePendingApprovalFailureDetail(
                typeof activityPayload?.detail === "string"
                  ? activityPayload.detail.toLowerCase()
                  : null,
              );
            });
            if (wasRequested && !wasResolved) {
              yield* projectionPendingApprovalRepository.upsert({
                ...existingRow.value,
                status: "pending",
                decision: null,
                resolvedAt: null,
              });
            }
            return;
          }
          // Only approval-requested activities should create pending-approval
          // rows.  Other activity kinds that happen to carry a requestId
          // (e.g. user-input.requested / user-input.resolved) must not
          // pollute this projection — they have their own accounting via
          // derivePendingUserInputCountFromActivities.
          if (event.payload.activity.kind !== "approval.requested") {
            return;
          }
          if (Option.isSome(existingRow) && existingRow.value.status === "resolved") {
            return;
          }
          yield* projectionPendingApprovalRepository.upsert({
            requestId,
            threadId: event.payload.threadId,
            turnId: event.payload.activity.turnId,
            status: "pending",
            decision: null,
            createdAt: Option.isSome(existingRow)
              ? existingRow.value.createdAt
              : event.payload.activity.createdAt,
            resolvedAt: null,
          });
          return;
        }

        case "thread.approval-response-requested": {
          const existingRow = yield* projectionPendingApprovalRepository.getByRequestId({
            requestId: event.payload.requestId,
          });
          yield* projectionPendingApprovalRepository.upsert({
            requestId: event.payload.requestId,
            threadId: Option.isSome(existingRow)
              ? existingRow.value.threadId
              : event.payload.threadId,
            turnId: Option.isSome(existingRow) ? existingRow.value.turnId : null,
            status: "resolved",
            decision: event.payload.decision,
            createdAt: Option.isSome(existingRow)
              ? existingRow.value.createdAt
              : event.payload.createdAt,
            resolvedAt: event.payload.createdAt,
          });
          return;
        }

        default:
          return;
      }
    });

    const projectors: ReadonlyArray<ProjectorDefinition> = [
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.projects,
        apply: applyProjectsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.channels,
        apply: applyChannelsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
        apply: applyThreadMessagesProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
        apply: applyThreadProposedPlansProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
        apply: applyThreadActivitiesProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
        apply: applyThreadSessionsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.threadTurns,
        apply: applyThreadTurnsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
        apply: applyCheckpointsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.pendingApprovals,
        apply: applyPendingApprovalsProjection,
      },
      {
        name: ORCHESTRATION_PROJECTOR_NAMES.threads,
        apply: applyThreadsProjection,
      },
    ];

    const applyAttachmentSideEffects = Effect.fn("applyAttachmentSideEffects")(
      function* (event: OrchestrationEvent, sideEffects: AttachmentSideEffects) {
        if (
          sideEffects.deletedThreadIds.size === 0 &&
          sideEffects.prunedThreadRelativePaths.size === 0
        ) {
          return;
        }

        const deletedThreadIds = new Set<string>();
        for (const threadId of sideEffects.deletedThreadIds) {
          const recreatedLater = yield* eventStore.hasEventAfter({
            aggregateKind: "thread",
            aggregateId: ThreadId.make(threadId),
            type: "thread.created",
            sequenceExclusive: event.sequence,
          });
          if (!recreatedLater) {
            deletedThreadIds.add(threadId);
          }
        }

        // Later events in the same transaction can add attachment references.
        const prunedThreadRelativePaths = new Map<string, Set<string>>();
        for (const threadId of sideEffects.prunedThreadRelativePaths.keys()) {
          const messages = yield* projectionThreadMessageRepository.listByThreadId({
            threadId: ThreadId.make(threadId),
          });
          const retainedPaths = collectThreadAttachmentRelativePaths(threadId, messages);
          const activities = yield* projectionThreadActivityRepository.listByThreadId({
            threadId: ThreadId.make(threadId),
          });
          for (const activity of activities) {
            if (activity.kind !== "user-input.answer-submitted") continue;
            const payload = decodeQuestionAttachmentAnswer(activity.payload);
            if (Option.isNone(payload)) continue;
            for (const attachment of Object.values(payload.value.attachmentsByQuestionId).flat()) {
              const relativePath = attachmentRelativePath(attachment);
              if (relativePath) retainedPaths.add(relativePath);
            }
          }
          prunedThreadRelativePaths.set(threadId, retainedPaths);
        }

        yield* runAttachmentSideEffects({ deletedThreadIds, prunedThreadRelativePaths });
      },
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ServerConfig, serverConfig),
      (effect, event) =>
        effect.pipe(
          Effect.as(true),
          Effect.catch((cause) =>
            Effect.logWarning("failed to apply projected attachment side-effects", {
              sequence: event.sequence,
              eventType: event.type,
              cause,
            }).pipe(Effect.as(false)),
          ),
        ),
    );

    const runProjectorForEvent = Effect.fn("runProjectorForEvent")(function* (
      projector: ProjectorDefinition,
      event: OrchestrationEvent,
    ) {
      const attachmentSideEffects: AttachmentSideEffects = {
        deletedThreadIds: new Set<string>(),
        prunedThreadRelativePaths: new Map<string, Set<string>>(),
      };

      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* projector.apply(event, attachmentSideEffects);
          yield* projectionStateRepository.upsert({
            projector: projector.name,
            lastAppliedSequence: event.sequence,
            updatedAt: event.occurredAt,
          });
        }),
      );
    });

    const bootstrapProjector = (projector: ProjectorDefinition) =>
      projectionStateRepository
        .getByProjector({
          projector: projector.name,
        })
        .pipe(
          Effect.flatMap((stateRow) =>
            Stream.runForEach(
              eventStore.readFromSequence(
                Option.isSome(stateRow) ? stateRow.value.lastAppliedSequence : 0,
                Number.MAX_SAFE_INTEGER,
              ),
              (event) => runProjectorForEvent(projector, event),
            ),
          ),
        );

    const projectEventDeferred: OrchestrationProjectionPipelineShape["projectEventDeferred"] =
      Effect.fn("projectEventDeferred")(
        function* (event) {
          const attachmentSideEffects: AttachmentSideEffects = {
            deletedThreadIds: new Set<string>(),
            prunedThreadRelativePaths: new Map<string, Set<string>>(),
          };
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* Effect.forEach(
                projectors,
                (projector) => projector.apply(event, attachmentSideEffects),
                { concurrency: 1, discard: true },
              );
              // Runtime projectors commit together. Bootstrap still advances each cursor separately.
              yield* projectionStateRepository.upsertMany(
                projectors.map((projector) => ({
                  projector: projector.name,
                  lastAppliedSequence: event.sequence,
                  updatedAt: event.occurredAt,
                })),
              );
            }),
          );
          // Return the cleanup effect so the caller runs it after the outer transaction commits.
          // @effect-diagnostics-next-line returnEffectInGen:off
          return applyAttachmentSideEffects(event, attachmentSideEffects).pipe(Effect.asVoid);
        },
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.provideService(ServerConfig, serverConfig),
        Effect.catchTag("SqlError", (sqlError) =>
          Effect.fail(toPersistenceSqlError("ProjectionPipeline.projectEvent:query")(sqlError)),
        ),
      );

    const projectEvent: OrchestrationProjectionPipelineShape["projectEvent"] = Effect.fn(
      "projectEvent",
    )(function* (event) {
      const cleanup = yield* projectEventDeferred(event);
      yield* cleanup;
    });

    // The projectors' own cursors, not the attachment-cleanup cursor that
    // shares the table: that cursor answers a different question ("the oldest
    // position anything still needs") and sits behind them here. An absent row
    // is 0. The MAXIMUM, because an epoch must cover every row ANY projector
    // crossed under its lists. The input that breaks the minimum: fast
    // projectors at 10, a slow one at 8, and a row at 9 of a type only a newer
    // build knows. The fast projectors crossed 9 under the old lists, so it is
    // a hole; an end of 8 lets the next epoch claim (8, ...] under the new
    // lists and nothing ever scans 9. With 10, the lacking epoch covers 9, and
    // the slow projector re-applying 9 and 10 under the new build is harmless.
    const maxProjectorWatermark = (states: ReadonlyArray<ProjectionState>) =>
      Math.max(
        ...projectors.map(
          (projector) =>
            states.find((state) => state.projector === projector.name)?.lastAppliedSequence ?? 0,
        ),
      );

    const listsEqual = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
      left.length === right.length && right.every((value) => left.includes(value));

    const carriesThisBuildsLists = (epoch: ProjectionDecoderEpoch) =>
      listsEqual(epoch.eventTypes, decodableEventTypes) &&
      listsEqual(epoch.aggregateKinds, decodableAggregateKinds);

    const scanEpochForHole = Effect.fn("scanEpochForHole")(function* (lacking: LackingEpoch) {
      return yield* projectionDecoderRepository.findHole({
        eventTypes: lacking.eventTypes,
        aggregateKinds: lacking.aggregateKinds,
        afterSequence: lacking.epoch.startedAtSequence,
        throughSequence: lacking.epoch.endedAtSequence,
      });
    });

    // A build that decodes a type an older build skipped must find the hole
    // and rebuild (t3_bot-n33f). The store skips a row whose type or kind the
    // running build does not know, and the projector watermark then crosses
    // that row for good: resuming from the watermark never applies it. The
    // ledger (migration 054) holds one epoch per decoder: the lists a build
    // could decode and the (started, ended] watermark range it applied with
    // them. The input this catches: an older build applied sequence 3 past a
    // sequence-2 row of a type only this build knows. The downgrade direction
    // is what makes it work: an older build starting on a newer ledger has an
    // empty delta, scans nothing, and opens an epoch of its own with its
    // smaller lists; the next newer build sees the delta and scans that epoch.
    // DISCLOSED: a database written before the ledger existed has no epoch
    // for those rows, so holes older than the ledger are not detectable.
    //
    // An epoch whose range scans clean is COVERED: this build's delta is added
    // to its lists. The scan proved no row of those types exists in that
    // range, so the larger lists are a true statement about it, the next
    // boot's delta for it is empty, and the unindexed scan does not run again
    // on every boot for the life of the database.
    const scanLackingEpochs = Effect.fn("scanLackingEpochs")(function* (
      epochs: ReadonlyArray<ProjectionDecoderEpoch>,
    ) {
      const clean: Array<LackingEpoch> = [];
      for (const epoch of epochs) {
        const eventTypes = decodableEventTypes.filter((type) => !epoch.eventTypes.includes(type));
        const aggregateKinds = decodableAggregateKinds.filter(
          (kind) => !epoch.aggregateKinds.includes(kind),
        );
        if (eventTypes.length === 0 && aggregateKinds.length === 0) continue;
        const lacking = { epoch, eventTypes, aggregateKinds };
        // An empty range holds no row at all, so the scan is already answered
        // and only the query is skipped, not the cover.
        if (epoch.endedAtSequence <= epoch.startedAtSequence) {
          clean.push(lacking);
          continue;
        }
        const hole = yield* scanEpochForHole(lacking);
        if (Option.isSome(hole)) return { _tag: "hole", hole: hole.value, epoch } as const;
        clean.push(lacking);
      }
      return { _tag: "clean", clean } as const;
    });

    // The fresh-install path: empty every projection table and cursor, drop
    // every epoch and open this build's at (0, 0], in ONE transaction, so no
    // crash can leave emptied tables under an older build's ledger. The replay
    // that follows starts from 0 like a new database. The repository calls
    // join the transaction: the client reads its connection from the fiber
    // context, and `withTransaction` provides the transaction connection to
    // the effect it wraps (effect/unstable/sql/SqlClient `makeWithTransaction`).
    // The ONE-transaction part is pinned by "leaves the tables and the ledger
    // untouched when the new epoch cannot be written" in
    // ProjectionPipeline.rebuild.test.ts, which refuses the insert with a
    // trigger: without the rollback that boot leaves emptied tables under no
    // ledger, which rebuilds on every later boot and can never find a hole.
    const rebuildProjections = Effect.fn("rebuildProjections")(function* () {
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* Effect.forEach(PROJECTION_TABLES, (table) => sql`DELETE FROM ${sql(table)}`, {
            discard: true,
          });
          yield* projectionDecoderRepository.deleteAllEpochs();
          yield* projectionDecoderRepository.appendEpoch({
            eventTypes: decodableEventTypes,
            aggregateKinds: decodableAggregateKinds,
            startedAtSequence: 0,
            endedAtSequence: 0,
          });
        }),
      );
    });

    const bootstrap: OrchestrationProjectionPipelineShape["bootstrap"] = Effect.gen(function* () {
      const cleanupProjector = "projection.attachment-cleanup";

      // (1) Repair the latest epoch's end before anything reads it. Rows
      // between its recorded end and the projectors' watermark were applied
      // live, or by a replay that was interrupted before step (5), under that
      // epoch's lists, so they belong to it. ASSUMPTION: one writer per
      // database, which is one server per T3 home. Two builds sharing one
      // userdata directory break it, because each would claim the other's rows
      // for its own epoch. DISCLOSED, and this is the whole coverage story for
      // a live tail: rows a build applies after its own boot are attributed to
      // an epoch only here, by the NEXT boot, under the latest epoch's lists.
      // That attribution is correct under the assumption and wrong without it,
      // and a build that applies rows live and is never followed by another
      // boot leaves them attributed to nothing at all.
      let states = yield* projectionStateRepository.listAll();
      const maxWatermark = maxProjectorWatermark(states);
      let epochs = yield* projectionDecoderRepository.listEpochs();
      const latest = epochs.at(-1);
      if (latest !== undefined && latest.endedAtSequence < maxWatermark) {
        yield* projectionDecoderRepository.extendEpoch({
          epoch: latest.epoch,
          endedAtSequence: maxWatermark,
        });
        epochs = yield* projectionDecoderRepository.listEpochs();
      }

      // (2) Scan every epoch that lacks part of this build's lists, over the
      // range it applied. (3a) A hit is a hole: warn once and rebuild.
      const scan = yield* scanLackingEpochs(epochs);
      if (scan._tag === "hole") {
        // The type and kind are columns a newer build wrote, so the message
        // bounds and escapes them: a 200,000-character type fills the log
        // line, and one carrying ESC or a newline forges log lines around it.
        // The annotations keep the raw values for the structured log.
        yield* Effect.logWarning(
          `orchestration projections rebuilt: sequence ${scan.hole.sequence} (${quoteForLog(scan.hole.eventType.slice(0, 120))}, ${quoteForLog(scan.hole.aggregateKind.slice(0, 120))}) was skipped by decoder epoch ${scan.epoch.epoch}`,
        ).pipe(
          Effect.annotateLogs({
            sequence: scan.hole.sequence,
            eventType: scan.hole.eventType,
            aggregateKind: scan.hole.aggregateKind,
            epoch: scan.epoch.epoch,
          }),
        );
        yield* rebuildProjections();
        // The rebuild emptied the cursors; everything below reads them again.
        states = yield* projectionStateRepository.listAll();
      } else {
        // (3b) No hole: cover every epoch that scanned clean, then open this
        // build's epoch unless the ledger already ends with its lists. A
        // covered latest epoch already carries them, so the ordinary upgrade
        // continues the chain instead of starting a new link.
        yield* Effect.forEach(
          scan.clean,
          (lacking) =>
            projectionDecoderRepository.coverEpoch({
              epoch: lacking.epoch.epoch,
              eventTypes: [...lacking.epoch.eventTypes, ...lacking.eventTypes],
              aggregateKinds: [...lacking.epoch.aggregateKinds, ...lacking.aggregateKinds],
            }),
          { discard: true },
        );
        const latestAfterCover =
          scan.clean.length === 0
            ? latest
            : (yield* projectionDecoderRepository.listEpochs()).at(-1);
        if (latestAfterCover === undefined) {
          // The first boot after migration 054 on a database that already has
          // rows. DISCLOSED: those rows get no epoch, so a hole older than the
          // ledger stays undetectable; this epoch starts where they ended.
          yield* projectionDecoderRepository.appendEpoch({
            eventTypes: decodableEventTypes,
            aggregateKinds: decodableAggregateKinds,
            startedAtSequence: maxWatermark,
            endedAtSequence: maxWatermark,
          });
        } else if (!carriesThisBuildsLists(latestAfterCover)) {
          yield* projectionDecoderRepository.appendEpoch({
            eventTypes: decodableEventTypes,
            aggregateKinds: decodableAggregateKinds,
            startedAtSequence: latestAfterCover.endedAtSequence,
            endedAtSequence: latestAfterCover.endedAtSequence,
          });
        }
      }

      // (4) The cleanup cursor keeps its own minimum: the lowest point any
      // cursor must replay from is a different question from an epoch's end.
      const byProjector = new Map(states.map((state) => [state.projector, state]));
      const cleanupState = byProjector.get(cleanupProjector);
      const cleanupStart = Math.min(
        cleanupState?.lastAppliedSequence ?? 0,
        ...projectors.map((projector) => byProjector.get(projector.name)?.lastAppliedSequence ?? 0),
      );
      // Persist this boundary before replay: a reset projector can encounter an old
      // revert, then fail after other projectors have committed past that event.
      yield* projectionStateRepository.upsert({
        projector: cleanupProjector,
        lastAppliedSequence: cleanupStart,
        updatedAt: cleanupState?.updatedAt ?? "1970-01-01T00:00:00.000Z",
      });
      yield* Effect.forEach(projectors, bootstrapProjector, { concurrency: 1, discard: true });

      // (5) Widen the open epoch to whatever the replay reached. Its row was
      // written BEFORE the replay, so a crash anywhere leaves this end
      // understated and never overstated, and step (1) repairs it on the next
      // boot under the lists that were in force while the rows were applied.
      const replayed = yield* projectionStateRepository.listAll();
      const open = (yield* projectionDecoderRepository.listEpochs()).at(-1);
      if (open !== undefined) {
        yield* projectionDecoderRepository.extendEpoch({
          epoch: open.epoch,
          endedAtSequence: Math.max(open.endedAtSequence, maxProjectorWatermark(replayed)),
        });
      }

      // Cleanup has its own cursor so retries never have to replay committed text.
      // All message and activity references are current before any files are removed.
      const pendingCleanup = new Map<string, OrchestrationEvent>();
      let lastEvent: OrchestrationEvent | undefined;
      yield* Stream.runForEach(
        eventStore.readFromSequence(cleanupStart, Number.MAX_SAFE_INTEGER),
        (event) =>
          Effect.sync(() => {
            lastEvent = event;
            if (event.type === "thread.reverted" || event.type === "thread.deleted") {
              pendingCleanup.set(`${event.type}:${event.payload.threadId}`, event);
            }
          }),
      );
      for (const event of pendingCleanup.values()) {
        if (event.type !== "thread.reverted" && event.type !== "thread.deleted") continue;
        const threadId = event.payload.threadId;
        const cleaned = yield* applyAttachmentSideEffects(event, {
          deletedThreadIds: new Set(event.type === "thread.deleted" ? [threadId] : []),
          prunedThreadRelativePaths: new Map(
            event.type === "thread.reverted" ? [[threadId, new Set<string>()]] : [],
          ),
        });
        // Leave the cleanup cursor behind this event so the next bootstrap retries it.
        if (!cleaned) return;
      }
      if (lastEvent) {
        yield* projectionStateRepository.upsert({
          projector: cleanupProjector,
          lastAppliedSequence: lastEvent.sequence,
          updatedAt: lastEvent.occurredAt,
        });
      }
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ServerConfig, serverConfig),
      Effect.asVoid,
      Effect.tap(() =>
        Effect.logDebug("orchestration projection pipeline bootstrapped").pipe(
          Effect.annotateLogs({ projectors: projectors.length }),
        ),
      ),
      Effect.catchTag("SqlError", (sqlError) =>
        Effect.fail(toPersistenceSqlError("ProjectionPipeline.bootstrap:query")(sqlError)),
      ),
    );

    return {
      bootstrap,
      projectEvent,
      projectEventDeferred,
    } satisfies OrchestrationProjectionPipelineShape;
  },
);

export const OrchestrationProjectionPipelineLive = Layer.effect(
  OrchestrationProjectionPipeline,
  makeOrchestrationProjectionPipeline(),
).pipe(
  Layer.provideMerge(ProjectionProjectRepositoryLive),
  Layer.provideMerge(ProjectionChannelRepositoryLive),
  Layer.provideMerge(ProjectionThreadRepositoryLive),
  Layer.provideMerge(ProjectionThreadMessageRepositoryLive),
  Layer.provideMerge(ProjectionThreadProposedPlanRepositoryLive),
  Layer.provideMerge(ProjectionThreadPullRequests.layer),
  Layer.provideMerge(ProjectionThreadActivityRepositoryLive),
  Layer.provideMerge(ProjectionThreadSessionRepositoryLive),
  Layer.provideMerge(ProjectionTurnRepositoryLive),
  Layer.provideMerge(ProjectionPendingApprovalRepositoryLive),
  Layer.provideMerge(ChannelPostWakeRepositoryLive),
  Layer.provideMerge(ProjectionStateRepositoryLive),
  Layer.provideMerge(ProjectionDecoderRepositoryLive),
);
