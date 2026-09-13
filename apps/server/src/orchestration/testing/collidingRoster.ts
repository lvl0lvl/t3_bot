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
 * was not under-tested; it was UNTESTABLE with the data we had. The sites that
 * then grew their own colliding fixture each spelled the collision differently:
 * `MentionWakeReactor.test.ts`, `decider.issuer.test.ts` (twice),
 * `commsLive.integration.test.ts`, `server.test.ts` (twice),
 * `ProjectionChannels.test.ts` — and the reactor's author exclusion had no
 * colliding test at all. This is the one spelling.
 *
 * THE ID IS THE OPERATOR'S ON PURPOSE. `HUMAN_OPERATOR_MEMBER_ID` is a name
 * every test already has a reason to know; the reactor's fixture used the
 * literal, and `server.test.ts` imported the constant by name because its
 * connection member IS the operator. A thread that happens to be created with
 * that id is exactly the shape of the real collision.
 *
 * HOW THE COLLISION ARRIVES, and why the fixture is EVENTS. It WAS reachable
 * by ordering: `requireChannelMemberShape` refuses a human member whose id
 * names a thread that EXISTS, at add time, so seating the human first and
 * creating thread X second was admitted, and adding the thread member last was
 * too (`t3_bot-46h` criterion 4, proven on #24). `t3_bot-7iw` closed that:
 * `thread.create` now refuses an id any channel holds as a HUMAN member's, and
 * the operator's id outright (`requireThreadIdIsNoHuman`). Both orderings are
 * refused for commands — precisely: no command sequence produces the pair from
 * a clean database. A database that already holds thread X beside human X,
 * written before 7iw, can still `channel.member.add` the thread half; that add
 * is admitted on purpose (`decider.channels.test.ts` pins it). What is left is
 * the path this module has always also modelled: a database written BEFORE
 * the invariant, whose rows replay into the projection and reach every lookup
 * untouched. That is why every membership comparison in
 * `scripts/guard-sweep.colliding-roster.json` keeps its kind clause, and why
 * this fixture is three appended EVENTS rather than three commands —
 * criterion 5 the other way round: the aggregate refuses the roster, so the
 * fixture is built from events, which is the path the real row arrives by.
 *
 * THREE CONSUMERS, BECAUSE TESTS REACH A ROSTER THREE WAYS. Tests that hold a
 * database append the three events and start an engine over them
 * (`appendCollidingRoster`). The decider's tests are pure and hold a read
 * model, so they take the roster AS THE EVENTS LEAVE IT (`collidingReadModel`).
 * Read-side tests that stub or write the projection directly take the rows
 * (`collidingMembers`, `COLLIDING_THREAD_MEMBER`), the refs
 * (`COLLIDING_HUMAN_REF`, `COLLIDING_THREAD_REF`) or an event's payload
 * (`COLLIDING_THREAD_PAYLOAD`). All produce the same collision; a test that
 * asserts the two members are told APART works against any of them.
 *
 * @module collidingRoster
 */
import {
  ChannelId,
  ChannelMemberHandle,
  CommandId,
  EventId,
  HUMAN_OPERATOR_MEMBER_ID,
  ProviderInstanceId,
  ThreadId,
  refFromOperatorSession,
  refFromThreadCredential,
  type ChannelMember,
  type ChannelMemberRef,
  type ChannelMemberRefPayload,
  type CommandIssuer,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type ProjectId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { OrchestrationEventStoreError } from "../../persistence/Errors.ts";
import type { OrchestrationEventStoreShape } from "../../persistence/Services/OrchestrationEventStore.ts";

/** The one id both members carry. */
const COLLIDING_MEMBER_ID = HUMAN_OPERATOR_MEMBER_ID;

export const COLLIDING_CHANNEL_ID = ChannelId.make("channel-collide");
export const COLLIDING_CHANNEL_NAME = "collide";

/** The thread that shares the operator's id. */
export const COLLIDING_THREAD_ID = ThreadId.make(COLLIDING_MEMBER_ID);

const COLLIDING_HUMAN_HANDLE = ChannelMemberHandle.make("walt");
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

/**
 * The thread half in the shape an EVENT PAYLOAD holds
 * (`ChannelMemberRemovedPayload.removedMember`): the plain struct, which the
 * contract types as `ChannelMemberRefPayload` and says the nominal ref must
 * not occupy. Same two fields as the issuer; the name says where it goes.
 */
export const COLLIDING_THREAD_PAYLOAD: ChannelMemberRefPayload = {
  memberKind: "thread",
  memberId: COLLIDING_MEMBER_ID,
};

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
 * HANDLES ARE THE TEST'S BUSINESS. The decider's tests assert the persisted
 * `authorHandle` against their own names, so the handle is the assertion's
 * subject and has to be the test's. The id collision is this module's; the
 * names are not.
 *
 * ORDER IS THE MEASUREMENT FOR THE DECIDER, not a detail. Its lookup is `find`,
 * which returns the FIRST row with a matching id, so the wrong row has to come
 * first for the issuer under test: human first when the author is the THREAD,
 * thread first when the author is the HUMAN. Reversed, that test passes under
 * an id-only lookup and measures nothing — a review lane proved that with all
 * 685 tests green over a broken guard. Human-first is the order commands
 * produced until `t3_bot-7iw`; thread-first is what replay of rows written
 * before `t3_bot-8i2` produces. Both arrive by replay now, and both are states
 * a lookup can be handed. `some` (the gateway, the shell stream) and the
 * projection's SQL `WHERE` answer a set question and are order-insensitive;
 * their tests distinguish by a NEGATIVE — a roster holding only the other
 * kind, asked about by this one.
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

/**
 * A read model holding the colliding roster, with the twin thread present.
 *
 * FOR THE DECIDER'S TESTS, which are pure and take a read model rather than an
 * engine. The thread row is there because this is what the projection holds
 * after the three events `appendCollidingRoster` writes, which reach every
 * comparison the same way a replayed row does.
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
  readonly first: "human" | "thread";
  readonly extra?: {
    readonly threads?: OrchestrationReadModel["threads"];
    readonly channels?: OrchestrationReadModel["channels"];
  };
}): OrchestrationReadModel => ({
  snapshotSequence: 0,
  projects: [],
  threads: [
    {
      id: COLLIDING_THREAD_ID,
      deletedAt: null,
    } as unknown as OrchestrationReadModel["threads"][number],
    ...(input.extra?.threads ?? []),
  ],
  channels: [
    {
      id: input.channelId ?? COLLIDING_CHANNEL_ID,
      name: input.channelName ?? COLLIDING_CHANNEL_NAME,
      members: collidingMembers({
        humanHandle: input.humanHandle ?? COLLIDING_HUMAN_HANDLE,
        threadHandle: input.threadHandle ?? COLLIDING_THREAD_HANDLE,
        first: input.first,
      }),
      archivedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    },
    ...(input.extra?.channels ?? []),
  ],
  updatedAt: input.now,
});

/**
 * The three events, appended to the store, for a test that then starts an
 * engine over them.
 *
 * FOR TESTS THAT HOLD A DATABASE. These are the events the three commands
 * produced while the aggregate still admitted the ordering; `t3_bot-7iw`
 * refuses `thread.create` for this id now, so a running engine cannot be asked
 * for them. Appending them is not a shortcut around the decider — it is the
 * case the decider cannot reach: rows written before the invariant. The
 * engine's read model is loaded at start and advanced per dispatched event, so
 * a caller appends these BEFORE starting the engine that will see them (or
 * disposes and starts a new one over the same database). `projectId` is the
 * caller's because a thread needs a project and the test already has one.
 *
 * Returns nothing: what a test does with the roster is the test's business.
 * Asserting anything here would pin the fixture to one consumer's question.
 */
export const appendCollidingRoster = (input: {
  readonly events: Pick<OrchestrationEventStoreShape, "append">;
  readonly projectId: ProjectId;
  readonly now: string;
}): Effect.Effect<void, OrchestrationEventStoreError> =>
  Effect.gen(function* () {
    const base = (
      kind: OrchestrationEvent["aggregateKind"],
      aggregateId: OrchestrationEvent["aggregateId"],
      name: string,
    ): Omit<OrchestrationEvent, "sequence" | "type" | "payload"> => ({
      eventId: EventId.make(`event-collide-${name}`),
      aggregateKind: kind,
      aggregateId,
      occurredAt: input.now,
      commandId: CommandId.make(`cmd-collide-${name}`),
      causationEventId: null,
      correlationId: CommandId.make(`cmd-collide-${name}`),
      metadata: {},
    });
    // 1. The human, seated. What `channel.create` wrote while no thread carried
    //    the id.
    yield* input.events.append({
      ...base("channel", COLLIDING_CHANNEL_ID, "channel"),
      type: "channel.created",
      payload: {
        channelId: COLLIDING_CHANNEL_ID,
        name: COLLIDING_CHANNEL_NAME,
        members: [COLLIDING_HUMAN_MEMBER],
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    // 2. The thread of that name, created after. The event `thread.create`
    //    would have produced before `requireThreadIdIsNoHuman` existed.
    yield* input.events.append({
      ...base("thread", COLLIDING_THREAD_ID, "thread"),
      type: "thread.created",
      payload: {
        threadId: COLLIDING_THREAD_ID,
        projectId: input.projectId,
        title: "Twin",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    // 3. The thread member, added. The roster now holds both kinds under one id.
    yield* input.events.append({
      ...base("channel", COLLIDING_CHANNEL_ID, "member"),
      type: "channel.member-added",
      payload: {
        channelId: COLLIDING_CHANNEL_ID,
        member: COLLIDING_THREAD_MEMBER,
        updatedAt: input.now,
      },
    });
  });
