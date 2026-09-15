import * as Encoding from "effect/Encoding";
import { CheckpointRef, ProjectId, type MessageId, type ThreadId } from "@t3tools/contracts";

const CHECKPOINT_REFS_PREFIX = "refs/t3/checkpoints";

export function checkpointRefForThreadTurn(threadId: ThreadId, turnCount: number): CheckpointRef {
  return CheckpointRef.make(
    `${CHECKPOINT_REFS_PREFIX}/${Encoding.encodeBase64Url(threadId)}/turn/${turnCount}`,
  );
}

/**
 * The tree turn `turnCount` started from, where `turn/N` is the tree turn N
 * left. The two differ when something else wrote to the checkout between the
 * turns — another thread sharing it, a merge — and turn N's diff runs from this
 * one so those writes are not listed as the turn's.
 */
export function turnStartCheckpointRefForThreadTurn(
  threadId: ThreadId,
  turnCount: number,
): CheckpointRef {
  return CheckpointRef.make(
    `${CHECKPOINT_REFS_PREFIX}/${Encoding.encodeBase64Url(threadId)}/start/${turnCount}`,
  );
}

/**
 * Where the tree a turn started from waits until the turn completes. The
 * capture runs before the provider is handed the turn and cannot know the
 * turn's count — the row for the previous turn may not have landed yet — so it
 * is keyed by the message that started the turn and moved to the count-keyed
 * ref once the count is settled.
 */
export function pendingTurnStartCheckpointRef(
  threadId: ThreadId,
  messageId: MessageId,
): CheckpointRef {
  return CheckpointRef.make(
    `${CHECKPOINT_REFS_PREFIX}/${Encoding.encodeBase64Url(threadId)}/start/pending/${Encoding.encodeBase64Url(messageId)}`,
  );
}

export function resolveThreadWorkspaceCwd(input: {
  readonly thread: {
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
  };
  readonly projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly workspaceRoot: string;
  }>;
}): string | undefined {
  const worktreeCwd = input.thread.worktreePath ?? undefined;
  if (worktreeCwd) {
    return worktreeCwd;
  }

  return input.projects.find((project) => project.id === input.thread.projectId)?.workspaceRoot;
}
