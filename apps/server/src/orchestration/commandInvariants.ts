import type {
  ChannelAuthorRef,
  ChannelId,
  ChannelMember,
  ChannelMemberHandle,
  CommandIssuer,
  OrchestrationChannel,
  OrchestrationCommand,
  OrchestrationProject,
  OrchestrationReadModel,
  OrchestrationThread,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { HUMAN_OPERATOR_MEMBER_ID } from "@t3tools/contracts";
import {
  canonicalChannelHandle,
  canonicalChannelName,
  describeForbiddenIdentityCharacter,
  isStorableCanonicalIdentity,
} from "@t3tools/shared/channelIdentity";
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
 * The issuer the engine stamped, refusing a command that arrived without one.
 *
 * The issuer rides the decider's input rather than the 89 command structs, so
 * the compiler cannot force a caller to supply it. This closes that: a channel
 * command with no issuer is REFUSED, never processed unauthenticated. Fail-open
 * was the original bug — `requireChannelAuthorIsMember` asked whether the
 * author was SOME member and never whether it was the CALLER.
 *
 * Every `channel.*` branch calls this. `decider.issuer.test.ts` asserts that by
 * name over the whole command union, so a new channel command that skips it
 * fails a test instead of shipping unauthorized.
 */
export function requireCommandIssuer(input: {
  readonly command: OrchestrationCommand;
  readonly issuer: CommandIssuer | undefined;
}): Effect.Effect<CommandIssuer, OrchestrationCommandInvariantError> {
  if (input.issuer !== undefined) {
    return Effect.succeed(input.issuer);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Command '${input.command.type}' arrived without an issuer and cannot be authorized.`,
    ),
  );
}

/**
 * The author of a post, derived from the issuer — never from the command.
 *
 * A `system` issuer is refused: a reactor has no handle, so it has nothing to
 * appear as in a channel. It may administer, not speak.
 */
export function requireIssuerCanAuthor(input: {
  readonly command: OrchestrationCommand;
  readonly issuer: CommandIssuer;
}): Effect.Effect<ChannelAuthorRef, OrchestrationCommandInvariantError> {
  // An ALLOW-list, named kind by kind. Written as `!== "system"` this granted
  // authorship to any kind added to CommandIssuer later — one contract edit
  // away from the fail-open bug this whole change exists to close.
  if (input.issuer.memberKind === "human" || input.issuer.memberKind === "thread") {
    return Effect.succeed({
      memberKind: input.issuer.memberKind,
      memberId: input.issuer.memberId,
    });
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `A '${input.issuer.memberKind}' issuer has no handle and cannot author a channel post.`,
    ),
  );
}

/**
 * Membership and channel administration are human-or-system only for M1.
 *
 * An agent thread that could add itself would be granting itself post and read
 * rights on any channel whose id it can name, and one that could remove a peer
 * would silently evict it from the wake set. Both were unguarded: `member.add`
 * checked only handle uniqueness and `member.remove` only that the handle was
 * present, neither asked who was issuing.
 */
export function requireIssuerCanAdminister(input: {
  readonly command: OrchestrationCommand;
  readonly issuer: CommandIssuer;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  // An ALLOW-list for the same reason as above: `!== "thread"` granted channel
  // administration to every kind that did not exist yet.
  if (input.issuer.memberKind === "human" || input.issuer.memberKind === "system") {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `A '${input.issuer.memberKind}' issuer cannot administer a channel: '${input.command.type}' requires a human or system issuer.`,
    ),
  );
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
  if (canonical.length === 0) {
    return Effect.fail(
      invariantError(
        input.command.type,
        `Channel name '${input.name}' is only sigils and whitespace and has no canonical form.`,
      ),
    );
  }
  if (!isStorableCanonicalIdentity(canonical)) {
    return Effect.fail(
      invariantError(
        input.command.type,
        `Channel name contains ${describeForbiddenIdentityCharacter(canonical)}, which cannot appear in a stored name.`,
      ),
    );
  }
  return Effect.succeed(canonical);
}

/**
 * The canonical name must be free, because migration 051 holds a UNIQUE index
 * on it and a name is how a mention reaches a channel.
 *
 * Without this the decider admits a command the projection must refuse, and the
 * caller gets "SQLITE(2067) constraint failed" naming the driver instead of the
 * problem — the one channel rejection that skips the invariant path. The
 * command still fails atomically, so this buys a usable error, not integrity.
 *
 * Archived channels count, exactly as they do in the index: an archived channel
 * still holds its name, and excluding them here would reopen the same gap.
 * `exceptChannelId` lets a rename keep its own name.
 */
export function requireChannelNameAvailable(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly name: string;
  readonly exceptChannelId?: ChannelId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const taken = input.readModel.channels.find(
    (channel) => channel.name === input.name && channel.id !== input.exceptChannelId,
  );
  if (taken === undefined) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Channel name '${input.name}' is already used by channel '${taken.id}'.`,
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

/**
 * An archived channel is READABLE and otherwise inert.
 *
 * Archiving is how a channel is retired. A retired channel that still accepts
 * posts wakes its members from something nobody is watching, and one whose
 * roster still moves lets a member be added to a channel nobody can post to, or
 * removed from one nobody is reading. Reading stays open because the history is
 * the point of keeping the channel at all.
 *
 * A RENAME is deliberately still allowed and is not a gap: channels have no
 * delete, so renaming an archived channel is the only way to free a name its
 * UNIQUE index still holds. See `requireChannelNameAvailable`.
 */
export function requireChannelNotArchived(input: {
  readonly command: OrchestrationCommand;
  readonly channel: OrchestrationChannel;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (input.channel.archivedAt === null) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Channel '${input.channel.id}' is archived and cannot handle command '${input.command.type}'.`,
    ),
  );
}

/**
 * Unarchiving needs an archived channel, so an already-live channel is refused.
 *
 * The mirror of `requireChannelNotArchived` on `channel.archive`: archiving an
 * already-archived channel used to re-stamp `archivedAt`, so an idempotent-
 * looking retry destroyed the answer to "when was this retired". Refusing both
 * no-ops keeps that timestamp meaning one thing.
 */
export function requireChannelArchived(input: {
  readonly command: OrchestrationCommand;
  readonly channel: OrchestrationChannel;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (input.channel.archivedAt !== null) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Channel '${input.channel.id}' is not archived and cannot handle command '${input.command.type}'.`,
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
  if (!isStorableCanonicalIdentity(canonical)) {
    return Effect.fail(
      invariantError(
        input.command.type,
        `Handle contains ${describeForbiddenIdentityCharacter(canonical)}, which cannot appear in a stored handle.`,
      ),
    );
  }
  // The brand's own predicate is "trimmed and non-empty", which the line above
  // has just established. Constructing through the schema would throw on
  // failure, and this runs inside the single command-worker fiber.
  return Effect.succeed(canonical as ChannelMemberHandle);
}

/**
 * A member's `memberId` must be the shape its `memberKind` claims.
 *
 * `memberKind` decides what a member IS — a thread that can be woken, or a human
 * who cannot. Nothing checked that the id matched the claim, so a `human` member
 * could carry a real thread's id, and a `thread` member could carry an id no
 * thread has. The first is an impersonation route: the human member appears in
 * the roster alongside the thread it names, and anything that resolves a member
 * to a thread by id reaches the real one.
 *
 * A `thread` member must resolve to a LIVE thread. Deletion is soft, and a member
 * pointing at a deleted thread is a member no mention can ever wake — accepting
 * it stores a roster entry that looks like a participant and is not one.
 *
 * The toolkit checks this too, for an agent-readable error. This is the guarantee:
 * its check and this write are not atomic, and every future caller inherits
 * whatever the aggregate accepts.
 */
export function requireChannelMemberShape(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly member: ChannelMember;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const namedThread = input.readModel.threads.find(
    (thread) => (thread.id as string) === (input.member.memberId as string),
  );
  if (input.member.memberKind === "thread") {
    if (namedThread === undefined) {
      return Effect.fail(
        invariantError(
          input.command.type,
          `Member '${input.member.handle}' claims memberKind 'thread' but '${input.member.memberId}' is not a thread.`,
        ),
      );
    }
    if (namedThread.deletedAt !== null) {
      return Effect.fail(
        invariantError(
          input.command.type,
          `Member '${input.member.handle}' names deleted thread '${input.member.memberId}', which can never be woken.`,
        ),
      );
    }
    return Effect.void;
  }
  if (namedThread !== undefined) {
    return Effect.fail(
      invariantError(
        input.command.type,
        `Member '${input.member.handle}' claims memberKind 'human' but '${input.member.memberId}' is a thread id.`,
      ),
    );
  }
  return Effect.void;
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
 * The uniqueness key for a member: the pair, as a tuple rather than `${kind}:${id}`.
 *
 * Not because the separator is reachable today — `memberKind` is a closed two-value
 * literal union, so no kind can contain a colon and the forged-separator collision
 * cannot happen — but because the tuple is free and stays correct if `memberKind` ever
 * becomes operator-supplied text, which is when a string key would start silently
 * merging refs. One function so the seated rows and the added rows cannot be keyed
 * differently.
 */
function refKey(member: ChannelMember): string {
  return JSON.stringify([member.memberKind, member.memberId]);
}

/**
 * TWO KEYS, BOTH UNIQUE PER CHANNEL: the handle and the member ref.
 *
 * A handle is the mention key, so duplicates would make a mention ambiguous and
 * wake the wrong member. Run this on canonical handles: "Boss1" and "boss1" are
 * two rows here and one mention key everywhere else, so comparing raw handles
 * admits exactly the ambiguity this exists to prevent.
 *
 * `(memberKind, memberId)` is the AUTHORIZATION key — every decision in the
 * system resolves a member by it, and `requireChannelAuthorIsMember` returns the
 * FIRST row that matches. Two rows with one ref under two handles were legal, and
 * then `authorHandle` — the handle a post is STORED under — was decided by array
 * position: `find` -> `findLast` changed the answer and no test could see it, and
 * the position is not even stable, since the projector appends in memory and
 * reloads `ORDER BY handle ASC`. Mentions are NOT affected and it is worth being
 * exact: they resolve by handle, and the wake reactor collects memberIds into a
 * Set, so two handles for one thread still wake it once. Removing one of the two
 * handles DID report success and evict nobody, because the remove path keys by
 * handle while access keys by the ref (`t3_bot-1ez`, `t3_bot-s4l`).
 *
 * ONE ID UNDER TWO KINDS STAYS LEGAL. That is a different collision, it is why
 * the author lookup compares both fields, and whether a channel may hold it at
 * all is `t3_bot-7iw`. Keying this on `memberId` alone would refuse it.
 *
 * THE PROPERTY IS OVER THE DELTA, NOT THE ROSTER: after this command, no two
 * seated handles name one ref. `adding` is checked against itself and against
 * `seated`; `seated` is NOT checked against itself, because a command answers for
 * the rows it admits and not for rows written before this invariant existed.
 * Re-validating the whole roster made a legacy duplicate block every later
 * `member.add` with an error naming a member the operator had not mentioned —
 * a wall where a diagnosis belongs, and the repair of that population is a
 * command of its own (`t3_bot-uw9`, `t3_bot-z7u`).
 *
 * The handle half narrows the same way and loses nothing: the projector keys
 * `channel_members` by handle as a SQL primary key, so `seated` cannot hold two
 * rows with one handle and that comparison was always vacuous.
 */
export function requireChannelMembersUnique(input: {
  readonly command: OrchestrationCommand;
  /** Rows already on the roster. Not compared against each other. */
  readonly seated: ReadonlyArray<ChannelMember>;
  /** Rows this command seats. Compared against each other and against `seated`. */
  readonly adding: ReadonlyArray<ChannelMember>;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const handles = new Set<string>(input.seated.map((member) => member.handle));
  // Keyed by a tuple rather than `${kind}:${id}`. Not because the separator is
  // reachable today — `memberKind` is a closed two-value literal union, so no kind can
  // contain a colon and the forged-separator collision cannot happen — but because the
  // tuple is free and stays correct if `memberKind` ever becomes operator-supplied
  // text, which is when the string key would start silently merging refs. The value is
  // the HANDLE rather than a bare Set membership, because the operator who reads this
  // refusal has to act on it and did not type the id.
  const refs = new Map<string, string>(
    input.seated.map((member) => [refKey(member), member.handle] as const),
  );
  for (const member of input.adding) {
    if (handles.has(member.handle)) {
      return Effect.fail(
        invariantError(
          input.command.type,
          `Handle '${member.handle}' is used twice in one channel.`,
        ),
      );
    }
    handles.add(member.handle);
    const ref = refKey(member);
    const seated = refs.get(ref);
    if (seated !== undefined) {
      return Effect.fail(
        invariantError(
          input.command.type,
          `Handles '${seated}' and '${member.handle}' are the same member ` +
            `('${member.memberKind}' '${member.memberId}') in one channel. One member is one ` +
            `row: a post's author is resolved by that pair and stored under whichever handle ` +
            `is found first, so a second handle for it decides authorship by row order.`,
        ),
      );
    }
    refs.set(ref, member.handle);
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

/**
 * A thread id may not be a human's member id.
 *
 * `requireChannelMemberShape` refuses a HUMAN member whose id names a thread
 * that exists — but it runs at add time, against the threads that exist THEN.
 * Seat the human first and create the thread second, and both are admitted:
 * one channel holds one id under two kinds, and every by-id lookup on it must
 * compare the kind or answer for the wrong member (`t3_bot-46h` pinned every
 * comparison in `scripts/guard-sweep.colliding-roster.json` on both axes;
 * `t3_bot-7iw` asked whether they should have to, and they keep the clause for
 * replay — last paragraph). The seeder seats the operator at boot, so the whole
 * route was ONE `thread.create` with the operator's id, from a paired client,
 * minting a thread whose MCP credential presents as `("thread", "human-walt")`.
 *
 * Two inputs, refused here, close the human-first ordering for commands (the
 * shape guard already refuses thread-first):
 *
 *   - an id any channel holds as a HUMAN member's `memberId` — the seated
 *     case; every channel, archived or not, because a roster does not stop
 *     being a roster when the channel is archived;
 *   - the operator's own id, seated or not — with `noSeedHierarchy` no human
 *     is seated yet, and a thread created then would make the seeder's own
 *     `channel.create` fail on the next boot (the shape guard refuses the
 *     human member because the thread now exists), leaving the operator in no
 *     channel at all. That is the input the seated check alone admits. When
 *     accounts exist this clause becomes every known human account id, read
 *     from the aggregate — not the session's id, which the decider does not
 *     have and which would admit a system issuer minting another account's.
 *
 * A THREAD member's id is not refused: a deleted thread's id may be created
 * again (`requireThreadAbsent` blocks only a live row) while a channel still
 * lists the old member, and that member is a thread, not a human. Refusing it
 * would turn every deleted-then-recreated draft into a refusal.
 *
 * Replay is untouched. A row written before this guard reaches every lookup
 * as before, which is why every membership comparison in
 * `scripts/guard-sweep.colliding-roster.json` keeps its kind clause.
 */
export function requireThreadIdIsNoHuman(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const id = input.threadId as string;
  const seatedHuman = input.readModel.channels.find((channel) =>
    channel.members.some((member) => member.memberKind === "human" && member.memberId === id),
  );
  if (seatedHuman === undefined && id !== HUMAN_OPERATOR_MEMBER_ID) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      seatedHuman === undefined
        ? `Thread id '${input.threadId}' is the operator's member id and cannot name a thread.`
        : `Thread id '${input.threadId}' is a human member of channel '${seatedHuman.id}' and cannot name a thread.`,
    ),
  );
}

/**
 * Re-exported so the decider and its tests keep one import, while the rule
 * itself lives in `@t3tools/shared/channelIdentity` for the toolkit to share.
 */
export { canonicalChannelHandle, canonicalChannelName };
