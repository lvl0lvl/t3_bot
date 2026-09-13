/**
 * ONE channel roster in which a THREAD member and a HUMAN member share a
 * `memberId`, built once and imported by every test that compares memberships.
 *
 * Three independent guards lost their `memberKind` clause in one day and every
 * suite stayed green (`t3_bot-46h`): the reactor's wake filter, the shell
 * stream's membership test, the decider's author lookup. Not three careless
 * authors — every fixture in the repository gave its members ids that differed
 * in BOTH fields, so `memberId === x` and `memberKind === k && memberId === x`
 * returned the same answer for every input any test supplied. The comparison
 * was not under-tested; it was UNTESTABLE with the data we had. Six sites in
 * five files then grew their own colliding fixture, each spelling the collision
 * differently, and a seventh comparison had none. This is the one spelling.
 *
 * THE ID IS THE OPERATOR'S ON PURPOSE. `HUMAN_OPERATOR_MEMBER_ID` is a name
 * every test already has a reason to know, and two of the home-grown fixtures
 * had already picked it by accident. A thread that happens to be
 * created with that id is exactly the shape of the real collision.
 *
 * WHY THE COLLISION IS REACHABLE AT ALL, and why the fixture is an ORDERING.
 * `requireChannelMemberShape` refuses a human member whose id names a thread
 * that EXISTS — it resolves the id against the read model at add time and never
 * re-validates a member already seated. `thread.create` takes a caller-supplied
 * id. So:
 *
 *   1. add the human member with id X, while no thread X exists   -> admitted
 *   2. create thread X                                             -> admitted
 *   3. add the thread member with id X                             -> admitted
 *
 * One roster, two kinds, one id, no invariant broken (`t3_bot-46h` criterion 4,
 * proven on #24 and recorded on `ChannelMemberRemovedPayload`). The naive
 * fixture — a human member carrying an existing thread's id, in one command —
 * is refused at step 1 by the shape guard and never reaches the membership
 * guard it was meant to test, which is how `decider.issuer.test.ts`'s
 * collision spent itself proving the wrong thing. Criterion 5 holds: nothing
 * here weakens the shape guard, and the ordering path does not need it to.
 *
 * THREE CONSUMERS, BECAUSE TESTS REACH A ROSTER THREE WAYS. Tests that hold a
 * running engine perform the three dispatches (`seedCollidingRoster`). The
 * decider's tests are pure and hold a read model, so they take the roster AS
 * EVENTS WOULD LEAVE IT (`collidingReadModel`) — which is also the path a row
 * written before the shape guard existed arrives by. Read-side tests that
 * stub or write the projection directly take the rows (`collidingMembers`,
 * `COLLIDING_THREAD_MEMBER`) or an event's ref (`COLLIDING_THREAD_REF`). All
 * produce the same collision; a test that asserts the two members are told
 * APART works against any of them.
 *
 * @module collidingRoster
 */
import {
  ChannelId,
  ChannelMemberHandle,
  CommandId,
  HUMAN_OPERATOR_MEMBER_ID,
  ProviderInstanceId,
  ThreadId,
  refFromOperatorSession,
  refFromThreadCredential,
  type ChannelMember,
  type ChannelMemberRef,
  type CommandIssuer,
  type OrchestrationReadModel,
  type ProjectId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { OrchestrationDispatchError } from "../Errors.ts";
import type { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";

/** The one id both members carry. */
export const COLLIDING_MEMBER_ID = HUMAN_OPERATOR_MEMBER_ID;

export const COLLIDING_CHANNEL_ID = ChannelId.make("channel-collide");
export const COLLIDING_CHANNEL_NAME = "collide";

/** The thread that shares the operator's id. */
export const COLLIDING_THREAD_ID = ThreadId.make(COLLIDING_MEMBER_ID);

export const COLLIDING_HUMAN_HANDLE = ChannelMemberHandle.make("walt");
export const COLLIDING_THREAD_HANDLE = ChannelMemberHandle.make("twin");

/**
 * The two refs, FROM THE CONTRACT'S OWN MAKERS rather than from literals.
 *
 * `ChannelMemberRef` is nominal on purpose — a literal cannot become one without
 * visibly going around the two constructors, which are named for their SOURCE.
 * The human half IS the operator: `refFromOperatorSession()` is
 * `("human", HUMAN_OPERATOR_MEMBER_ID)` by definition, so the collision needs no
 * spelling of the id at all on this side. The thread half takes the branded id.
 */
export const COLLIDING_HUMAN_REF: ChannelMemberRef = refFromOperatorSession();
export const COLLIDING_THREAD_REF: ChannelMemberRef = refFromThreadCredential(COLLIDING_THREAD_ID);

/**
 * The same two identities as ISSUERS, the plain shape `dispatch` takes.
 *
 * `as const` rather than `: CommandIssuer`, so each keeps its literal kind: a
 * consumer that only posts as a member takes `"human" | "thread"`, and a value
 * widened to `CommandIssuer` — which admits `"system"` — would not fit it.
 * Both still satisfy `CommandIssuer` where that is what is asked for.
 */
export const COLLIDING_HUMAN_ISSUER = {
  memberKind: "human",
  memberId: COLLIDING_MEMBER_ID,
} as const satisfies CommandIssuer;
export const COLLIDING_THREAD_ISSUER = {
  memberKind: "thread",
  memberId: COLLIDING_MEMBER_ID,
} as const satisfies CommandIssuer;

export const COLLIDING_HUMAN_MEMBER: ChannelMember = {
  handle: COLLIDING_HUMAN_HANDLE,
  memberKind: "human",
  memberId: COLLIDING_MEMBER_ID,
};

export const COLLIDING_THREAD_MEMBER: ChannelMember = {
  handle: COLLIDING_THREAD_HANDLE,
  memberKind: "thread",
  memberId: COLLIDING_MEMBER_ID,
};

/**
 * The two colliding members, with the caller's HANDLES, in the caller's ORDER.
 *
 * HANDLES ARE THE TEST'S BUSINESS. `requireChannelHandlesUnique` is the one
 * uniqueness invariant a roster has, so a fixed handle here collides with any
 * test that already seats one — `decider.issuer.test.ts` seats `walt` in a
 * test about exactly that guard. The id collision is this module's; the names
 * are not.
 *
 * ORDER IS THE MEASUREMENT, not a detail. `find` returns the FIRST row with a
 * matching id, so the wrong row has to come first for the issuer under test:
 * human first when the author is the THREAD, thread first when the author is
 * the HUMAN. Reversed, a test passes under an id-only lookup and measures
 * nothing — a review lane proved that with all 685 tests green over a broken
 * guard. The aggregate itself produces human-first (the only order the shape
 * guard admits); thread-first is what REPLAY of pre-invariant events produces,
 * and both are states a lookup can be handed.
 */
export const collidingMembers = (input: {
  readonly humanHandle: ChannelMemberHandle;
  readonly threadHandle: ChannelMemberHandle;
  readonly first: "human" | "thread";
}): ReadonlyArray<ChannelMember> => {
  const human: ChannelMember = {
    handle: input.humanHandle,
    memberKind: "human",
    memberId: COLLIDING_MEMBER_ID,
  };
  const thread: ChannelMember = {
    handle: input.threadHandle,
    memberKind: "thread",
    memberId: COLLIDING_MEMBER_ID,
  };
  return input.first === "human" ? [human, thread] : [thread, human];
};

/** This module's own handles, human first: the roster `seedCollidingRoster` seats. */
export const COLLIDING_MEMBERS: ReadonlyArray<ChannelMember> = collidingMembers({
  humanHandle: COLLIDING_HUMAN_HANDLE,
  threadHandle: COLLIDING_THREAD_HANDLE,
  first: "human",
});

/**
 * A read model holding the colliding roster, with the twin thread present.
 *
 * FOR THE DECIDER'S TESTS, which are pure and take a read model rather than an
 * engine. The thread row is there because `requireChannelAuthorIsMember` is
 * reached only for a thread issuer that exists, and because this is what the
 * projection holds after the three commands — or after a pre-invariant event
 * replays, which reaches every comparison the same way.
 *
 * `extra` lets a test add its own threads and channels beside the collision
 * rather than replacing it; the collision is the point and must not be lost
 * to a spread.
 */
export const collidingReadModel = (input: {
  readonly now: string;
  readonly channelId?: ChannelId;
  readonly channelName?: string;
  readonly humanHandle?: ChannelMemberHandle;
  readonly threadHandle?: ChannelMemberHandle;
  readonly first?: "human" | "thread";
  readonly extra?: {
    readonly threads?: OrchestrationReadModel["threads"];
    readonly channels?: OrchestrationReadModel["channels"];
  };
}): OrchestrationReadModel => ({
  snapshotSequence: 0,
  projects: [],
  threads: [
    ...(input.extra?.threads ?? []),
    {
      id: COLLIDING_THREAD_ID,
      deletedAt: null,
    } as unknown as OrchestrationReadModel["threads"][number],
  ],
  channels: [
    ...(input.extra?.channels ?? []),
    {
      id: input.channelId ?? COLLIDING_CHANNEL_ID,
      name: input.channelName ?? COLLIDING_CHANNEL_NAME,
      members: collidingMembers({
        humanHandle: input.humanHandle ?? COLLIDING_HUMAN_HANDLE,
        threadHandle: input.threadHandle ?? COLLIDING_THREAD_HANDLE,
        first: input.first ?? "human",
      }),
      archivedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    },
  ],
  updatedAt: input.now,
});

/**
 * The three commands, in the only order the aggregate admits them, against a
 * running engine.
 *
 * FOR TESTS THAT HOLD AN ENGINE. `projectId` is the caller's because a thread
 * needs a project and the test already has one; `issuer` is who creates the
 * channel and adds the member, and it has to be someone the aggregate lets
 * administer — a human or system ref, per `requireIssuerCanAdminister`.
 *
 * Returns nothing: the roster is now in the projection, and what a test does
 * with it is the test's business. Asserting anything here would pin the
 * fixture to one consumer's question.
 */
export const seedCollidingRoster = (input: {
  readonly engine: OrchestrationEngineService["Service"];
  readonly projectId: ProjectId;
  readonly issuer: CommandIssuer;
  readonly now: string;
}): Effect.Effect<void, OrchestrationDispatchError> =>
  Effect.gen(function* () {
    // 1. The human is seated while no thread carries the id: the shape guard
    //    finds no thread named X and admits a human called X.
    yield* input.engine.dispatch(
      {
        type: "channel.create",
        commandId: CommandId.make("cmd-collide-channel"),
        channelId: COLLIDING_CHANNEL_ID,
        name: COLLIDING_CHANNEL_NAME,
        members: [COLLIDING_HUMAN_MEMBER],
        createdAt: input.now,
      },
      { issuer: input.issuer },
    );
    // 2. The thread of that name is created AFTER. Nothing re-validates the
    //    member already on the roster.
    yield* input.engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make("cmd-collide-thread"),
      projectId: input.projectId,
      threadId: COLLIDING_THREAD_ID,
      title: "Twin",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: input.now,
    });
    // 3. The thread member is added: the shape guard finds thread X and admits
    //    a thread member called X. The roster now holds both.
    yield* input.engine.dispatch(
      {
        type: "channel.member.add",
        commandId: CommandId.make("cmd-collide-member"),
        channelId: COLLIDING_CHANNEL_ID,
        member: COLLIDING_THREAD_MEMBER,
      },
      { issuer: input.issuer },
    );
  });
