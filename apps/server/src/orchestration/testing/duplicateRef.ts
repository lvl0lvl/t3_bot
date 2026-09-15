/**
 * ONE channel roster holding ONE MEMBER UNDER TWO HANDLES: two rows with the
 * same `memberKind` AND the same `memberId`, differing only in `handle`.
 *
 * NOT THE SAME STATE AS `./collidingRoster.ts`, and the difference is the whole
 * reason this module exists. That one seats a HUMAN and a THREAD sharing a
 * `memberId` — two rows whose `memberKind` differs, so they are two DIFFERENT
 * refs, and the guard it measures is the `memberKind` clause. Here both rows
 * carry the SAME ref, the kind clause is irrelevant, and what decides the
 * answer is ROW ORDER. A test that wants the kind clause wants the other
 * module; a test written against that one cannot see this defect at all,
 * because only one of its rows matches the author predicate and `find` and
 * `findLast` return the same row.
 *
 * WHAT IT IS FOR. `requireChannelAuthorIsMember` resolves a post's author with
 * `.find()` (`../commandInvariants.ts:513-517`). With two rows holding one ref,
 * `find` returns the first and `findLast` returns the second, and the two
 * differ in the handle the post is STORED under. The invariant that refuses
 * this state says so itself, which is why this module cites it rather than
 * arguing the point (`../commandInvariants.ts:491-494`):
 *
 *     "One member is one row: a post's author is resolved by that pair and
 *      stored under whichever handle is found first, so a second handle for it
 *      decides authorship by row order."
 *
 * WHY THE ROSTER IS NOT COMMAND-PRODUCIBLE, measured at main 7e02fa7308 by
 * reading all three sites that seat members:
 *
 *   `channel.create`         `requireChannelMembersUnique({ seated: [], adding: members })`
 *                            (`../decider.ts:2070`) compares `adding` against
 *                            ITSELF, so two members sharing a ref are refused.
 *   `channel.member.add`     `({ seated: channel.members, adding: [member] })`
 *                            (`../decider.ts:2194`) compares the new row against
 *                            every seated row, so a second handle for a seated
 *                            ref is refused.
 *   `channel.member.rename`  `({ seated: members.filter(h !== from), adding: [renamed] })`
 *                            (`../decider.ts:2316`) lifts the renamed row OUT of
 *                            `seated`, so on a roster with no existing duplicate
 *                            only the HANDLE clause can fire — and a rename
 *                            changes a handle on a row that already exists. It
 *                            never ADDS a row, so it cannot take the count of
 *                            rows holding one ref from one to two whatever the
 *                            invariant does.
 *
 * So no command sequence produces it from a clean database. What is NOT
 * re-validated is `seated` against itself, and that is deliberate — the
 * invariant's own docstring says a command "answers for the rows it admits and
 * not for rows written before this invariant existed"
 * (`../commandInvariants.ts:446`), because re-validating the whole roster made a
 * legacy duplicate block every later `member.add` with an error naming a member
 * the operator had never mentioned. The state therefore persists in any
 * database written before `t3_bot-1ez` and reaches every lookup by replay,
 * untouched. Same reachability shape as the colliding roster, for the same
 * reason, which is why both modules are fixtures rather than command sequences.
 *
 * ORDER IS THE MEASUREMENT, not a detail. Both rows match the author predicate,
 * so `find` returns the FIRST and the mutant returns the SECOND. A test must
 * therefore assert the FIRST seated row's handle and name which row that is;
 * asserting "some handle" or the second one passes under both and measures
 * nothing. The caller chooses the handles and the order for the same reason
 * `collidingRoster` lets it: the handle is the assertion's subject and belongs
 * to the test.
 *
 * @module duplicateRef
 */
import {
  ChannelId,
  ChannelMemberHandle,
  HUMAN_OPERATOR_MEMBER_ID,
  type ChannelMember,
  type CommandIssuer,
  type OrchestrationReadModel,
} from "@t3tools/contracts";

/** The one ref both rows carry. The operator's, as in `./collidingRoster.ts`. */
const DUPLICATE_MEMBER_ID = HUMAN_OPERATOR_MEMBER_ID;

export const DUPLICATE_CHANNEL_ID = ChannelId.make("channel-duplicate-ref");
export const DUPLICATE_CHANNEL_NAME = "duplicate-ref";

/**
 * The two handles one member is seated under.
 *
 * `walt` is the canonical row; `walt-legacy` is the second handle a pre-`1ez`
 * database can still hold for the same person. Exported so a test names them
 * rather than spelling literals that would not move if the fixture did.
 */
export const DUPLICATE_CANONICAL_HANDLE = ChannelMemberHandle.make("walt");
export const DUPLICATE_LEGACY_HANDLE = ChannelMemberHandle.make("walt-legacy");

/**
 * The shared identity as an ISSUER, the plain shape `dispatch` takes.
 *
 * `as const` rather than `: CommandIssuer` so the kind stays literal: a consumer
 * that only posts as a member takes `"human" | "thread"`, and a value widened to
 * `CommandIssuer` — which admits `"system"` — would not fit it.
 */
export const DUPLICATE_ISSUER = {
  memberKind: "human",
  memberId: DUPLICATE_MEMBER_ID,
} as const satisfies CommandIssuer;

/**
 * The two rows, in the caller's ORDER, with the caller's HANDLES.
 *
 * `first` names the handle that goes first, and that is the discriminating
 * input: the author lookup returns the first matching row, so a test asserting
 * the first row's handle reds under `findLast` and a test asserting the second
 * one is green under both.
 */
export const duplicateRefMembers = (input: {
  readonly canonicalHandle: ChannelMemberHandle;
  readonly legacyHandle: ChannelMemberHandle;
  readonly first: "canonical" | "legacy";
}): ReadonlyArray<ChannelMember> => {
  const canonical: ChannelMember = {
    handle: input.canonicalHandle,
    memberKind: "human",
    memberId: DUPLICATE_MEMBER_ID,
  };
  const legacy: ChannelMember = {
    handle: input.legacyHandle,
    memberKind: "human",
    memberId: DUPLICATE_MEMBER_ID,
  };
  return input.first === "canonical" ? [canonical, legacy] : [legacy, canonical];
};

/**
 * A read model holding the duplicate-ref roster.
 *
 * FOR THE DECIDER'S TESTS, which are pure and take a read model rather than an
 * engine. This is the roster as a replay of pre-`1ez` rows leaves it.
 *
 * THERE IS NO EVENT-APPENDING SIBLING HERE, and that is a departure from what
 * `t3_bot-h2u6` asked for — it specified a fixture built by appending events
 * with the engine restarted over them, as `collidingRoster.ts` does. It is not
 * built because no consumer holds a database yet, and an unused builder is a
 * claim about a path nobody runs. The departure and its consequence are
 * `t3_bot-74kz`: the handle-ASC ordering above is read off the SQL and asserted
 * in a comment here, NOT executed, so nothing yet proves a restarted engine
 * actually produces it. The events that would are a `channel.created` seating
 * one handle and a `channel.member-added` seating the second for the same ref —
 * the add the aggregate now refuses.
 *
 * `extra` lets a test add its own channels beside this one rather than replacing
 * it; the duplicate is the point and must not be lost to a spread.
 */
export const duplicateRefReadModel = (input: {
  readonly now: string;
  readonly channelId?: ChannelId;
  readonly channelName?: string;
  readonly canonicalHandle?: ChannelMemberHandle;
  readonly legacyHandle?: ChannelMemberHandle;
  readonly first: "canonical" | "legacy";
  readonly extra?: {
    readonly threads?: OrchestrationReadModel["threads"];
    readonly channels?: OrchestrationReadModel["channels"];
  };
}): OrchestrationReadModel => ({
  snapshotSequence: 0,
  projects: [],
  threads: [...(input.extra?.threads ?? [])],
  channels: [
    {
      id: input.channelId ?? DUPLICATE_CHANNEL_ID,
      name: input.channelName ?? DUPLICATE_CHANNEL_NAME,
      members: duplicateRefMembers({
        canonicalHandle: input.canonicalHandle ?? DUPLICATE_CANONICAL_HANDLE,
        legacyHandle: input.legacyHandle ?? DUPLICATE_LEGACY_HANDLE,
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
