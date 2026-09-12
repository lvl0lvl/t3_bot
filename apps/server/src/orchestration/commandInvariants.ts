import type {
  ChannelAuthorRef,
  ChannelId,
  ChannelMember,
  ChannelMemberHandle,
  OrchestrationChannel,
  OrchestrationCommand,
  OrchestrationProject,
  OrchestrationReadModel,
  OrchestrationThread,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import * as Effect from "effect/Effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";

function invariantError(commandType: string, detail: string): OrchestrationCommandInvariantError {
  return new OrchestrationCommandInvariantError({
    commandType,
    detail,
  });
}

function findThreadById(
  readModel: OrchestrationReadModel,
  threadId: ThreadId,
): OrchestrationThread | undefined {
  return readModel.threads.find((thread) => thread.id === threadId);
}

function findProjectById(
  readModel: OrchestrationReadModel,
  projectId: ProjectId,
): OrchestrationProject | undefined {
  return readModel.projects.find((project) => project.id === projectId);
}

export function listThreadsByProjectId(
  readModel: OrchestrationReadModel,
  projectId: ProjectId,
): ReadonlyArray<OrchestrationThread> {
  return readModel.threads.filter((thread) => thread.projectId === projectId);
}

/**
 * The canonical form of a channel name: lowercase, no leading sigils, trimmed.
 *
 * Applied in the decider so the projection only ever holds canonical names and
 * a plain byte comparison is correct. The comms toolkit normalises too, for a
 * readable error, but this is the guarantee — an agent typing "#Seniors" and
 * one typing "seniors" must reach the same channel, and a failed name lookup
 * is deliberately indistinguishable from "you are not a member", so a case
 * mismatch would otherwise be unreportable.
 *
 * Every leading sigil goes, not just one: the sigil is decoration, so "##general"
 * is a fat-finger that must resolve rather than create a second channel. The
 * exact rule is pinned as a table in `canonicalChannelName.test.ts`; the two
 * normalisers have diverged once already, over exactly this.
 */
export function canonicalChannelName(name: string): string {
  return canonicalise(name, /^#+/);
}

/**
 * The same rule for a member handle, with "@" as the sigil.
 *
 * Handles carry the name rule's failure one level down. The toolkit passes a
 * mention through byte-exact today and is to fold it later; folding THERE while
 * handles are stored as typed makes every capitalised mention unresolvable and
 * refuses the post whole, so the aggregate has to fold first. Folding here also
 * makes "Boss1" and "boss1" collide in the uniqueness check, which is the point
 * of that check: stored apart, they are one ambiguous mention key to every
 * reader.
 */
export function canonicalChannelHandle(handle: string): string {
  return canonicalise(handle, /^@+/);
}

/** One rule, two sigils, so a name and a handle cannot drift apart. */
function canonicalise(value: string, sigil: RegExp): string {
  return value.trim().replace(sigil, "").trim().toLowerCase();
}

/**
 * The canonical name to store, refusing one that canonicalises to empty.
 *
 * The command schema validates the RAW name, so a name of only sigils and
 * spaces passes `TrimmedNonEmptyString` and canonicalises to "" — the value
 * validated is not the value stored. Such a channel is unreachable through the
 * toolkit, which rejects an empty lookup before it calls the gateway, while it
 * holds the empty-string slot against every later creation. Callers take the
 * name from here rather than from `canonicalChannelName` so the check cannot
 * be skipped.
 */
export function requireCanonicalChannelName(input: {
  readonly command: OrchestrationCommand;
  readonly name: string;
}): Effect.Effect<string, OrchestrationCommandInvariantError> {
  const canonical = canonicalChannelName(input.name);
  if (canonical.length > 0) {
    return Effect.succeed(canonical);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Channel name '${input.name}' is only sigils and whitespace and has no canonical form.`,
    ),
  );
}

function findChannelById(
  readModel: OrchestrationReadModel,
  channelId: ChannelId,
): OrchestrationChannel | undefined {
  return readModel.channels.find((channel) => channel.id === channelId);
}

export function requireChannel(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly channelId: ChannelId;
}): Effect.Effect<OrchestrationChannel, OrchestrationCommandInvariantError> {
  const channel = findChannelById(input.readModel, input.channelId);
  if (channel) {
    return Effect.succeed(channel);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Channel '${input.channelId}' does not exist for command '${input.command.type}'.`,
    ),
  );
}

export function requireChannelAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly channelId: ChannelId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (!findChannelById(input.readModel, input.channelId)) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Channel '${input.channelId}' already exists and cannot be created twice.`,
    ),
  );
}

/**
 * The canonical handle to store, refusing one that canonicalises to empty.
 *
 * Carries the same hole as a name: `ChannelMemberHandle` validates the RAW
 * handle, so "@" passes and would be stored as "". Callers take the handle from
 * here rather than from `canonicalChannelHandle` so the check cannot be skipped.
 */
export function requireCanonicalChannelHandle(input: {
  readonly command: OrchestrationCommand;
  readonly handle: string;
}): Effect.Effect<ChannelMemberHandle, OrchestrationCommandInvariantError> {
  const canonical = canonicalChannelHandle(input.handle);
  if (canonical.length === 0) {
    return Effect.fail(
      invariantError(
        input.command.type,
        `Handle '${input.handle}' is only sigils and whitespace and has no canonical form.`,
      ),
    );
  }
  // The brand's own predicate is "trimmed and non-empty", which the line above
  // has just established. Constructing through the schema would throw on
  // failure, and this runs inside the single command-worker fiber.
  return Effect.succeed(canonical as ChannelMemberHandle);
}

/** A member with its handle canonicalised, refusing one with no canonical form. */
export function requireCanonicalChannelMember(input: {
  readonly command: OrchestrationCommand;
  readonly member: ChannelMember;
}): Effect.Effect<ChannelMember, OrchestrationCommandInvariantError> {
  return requireCanonicalChannelHandle({
    command: input.command,
    handle: input.member.handle,
  }).pipe(Effect.map((handle) => ({ ...input.member, handle })));
}

/**
 * A handle is the mention key, so it must be unique within its channel.
 * Duplicates would make a mention ambiguous and wake the wrong member.
 *
 * Run this on canonical handles: "Boss1" and "boss1" are two rows here and one
 * mention key everywhere else, so comparing raw handles admits exactly the
 * ambiguity this exists to prevent.
 */
export function requireChannelHandlesUnique(input: {
  readonly command: OrchestrationCommand;
  readonly members: ReadonlyArray<ChannelMember>;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const seen = new Set<string>();
  for (const member of input.members) {
    if (seen.has(member.handle)) {
      return Effect.fail(
        invariantError(
          input.command.type,
          `Handle '${member.handle}' is used twice in one channel.`,
        ),
      );
    }
    seen.add(member.handle);
  }
  return Effect.void;
}

/**
 * The author must be a current member at write time. The comms toolkit checks
 * this first for a readable error, but that check and this write are not
 * atomic, so the aggregate is the enforcement point every caller inherits.
 */
export function requireChannelAuthorIsMember(input: {
  readonly command: OrchestrationCommand;
  readonly channel: OrchestrationChannel;
  readonly authorRef: ChannelAuthorRef;
}): Effect.Effect<ChannelMember, OrchestrationCommandInvariantError> {
  const author = input.channel.members.find(
    (member) =>
      member.memberKind === input.authorRef.memberKind &&
      member.memberId === input.authorRef.memberId,
  );
  if (author) {
    return Effect.succeed(author);
  }
  return Effect.fail(
    invariantError(input.command.type, `Author is not a member of channel '${input.channel.id}'.`),
  );
}

/**
 * Every mention must resolve to a current member, and the post is rejected
 * whole when one does not. A post that silently drops a mention wakes nobody
 * while looking sent.
 */
export function requireChannelMentionsResolve(input: {
  readonly command: OrchestrationCommand;
  readonly channel: OrchestrationChannel;
  readonly mentions: ReadonlyArray<ChannelMemberHandle>;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const handles = new Set(input.channel.members.map((member) => member.handle));
  const unresolved = input.mentions.filter((handle) => !handles.has(handle));
  if (unresolved.length === 0) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Mentions do not resolve to members of channel '${input.channel.id}': ${unresolved.join(", ")}.`,
    ),
  );
}

export function requireProject(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly projectId: ProjectId;
}): Effect.Effect<OrchestrationProject, OrchestrationCommandInvariantError> {
  const project = findProjectById(input.readModel, input.projectId);
  if (project) {
    return Effect.succeed(project);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Project '${input.projectId}' does not exist for command '${input.command.type}'.`,
    ),
  );
}

export function requireProjectAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly projectId: ProjectId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (!findProjectById(input.readModel, input.projectId)) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Project '${input.projectId}' already exists and cannot be created twice.`,
    ),
  );
}

export function requireActiveProjectWorkspaceRootAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly workspaceRoot: string;
  readonly exceptProjectId?: ProjectId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const normalizedWorkspaceRoot = normalizeProjectPathForComparison(input.workspaceRoot);
  const existingProject = input.readModel.projects.find(
    (project) =>
      project.deletedAt === null &&
      normalizeProjectPathForComparison(project.workspaceRoot) === normalizedWorkspaceRoot &&
      project.id !== input.exceptProjectId,
  );
  if (existingProject === undefined) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Active project '${existingProject.id}' already exists for workspace root '${normalizedWorkspaceRoot}'.`,
    ),
  );
}

export function requireThread(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<OrchestrationThread, OrchestrationCommandInvariantError> {
  const thread = findThreadById(input.readModel, input.threadId);
  if (thread) {
    return Effect.succeed(thread);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Thread '${input.threadId}' does not exist for command '${input.command.type}'.`,
    ),
  );
}

export function requireThreadArchived(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<OrchestrationThread, OrchestrationCommandInvariantError> {
  return requireThread(input).pipe(
    Effect.flatMap((thread) =>
      thread.archivedAt !== null
        ? Effect.succeed(thread)
        : Effect.fail(
            invariantError(
              input.command.type,
              `Thread '${input.threadId}' is not archived for command '${input.command.type}'.`,
            ),
          ),
    ),
  );
}

export function requireThreadNotArchived(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<OrchestrationThread, OrchestrationCommandInvariantError> {
  return requireThread(input).pipe(
    Effect.flatMap((thread) =>
      thread.archivedAt === null
        ? Effect.succeed(thread)
        : Effect.fail(
            invariantError(
              input.command.type,
              `Thread '${input.threadId}' is already archived and cannot handle command '${input.command.type}'.`,
            ),
          ),
    ),
  );
}

export function requireThreadAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  // Thread deletion is a soft delete and a draft keeps its client-minted id
  // across retries, so only a live row blocks creation. Projectors reset the
  // thread's rows when the id is created again.
  const existing = findThreadById(input.readModel, input.threadId);
  if (existing === undefined || existing.deletedAt !== null) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Thread '${input.threadId}' already exists and cannot be created twice.`,
    ),
  );
}
