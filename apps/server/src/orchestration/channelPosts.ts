/**
 * One page of a channel's posts, for every client door.
 *
 * ONE HANDLER, TWO THIN TRANSPORTS, and that is the shape rather than a
 * preference. `#19` is the two-site divergence: `ClientOrchestrationCommand` is the
 * payload of both the WebSocket RPC and `POST /api/orchestration/dispatch`, and a
 * change taught one of them to stamp an issuer — a guard wired at two call sites and
 * present at one.
 *
 * `#20` IS A DIFFERENT LESSON, and this docstring used to get it wrong by claiming the
 * socket had channels and HTTP did not. Neither snapshot door had them (`be65225fc`:
 * "The snapshot the client keeps had no `channels` field at all"), and the stream that
 * did only fires when a channel CHANGES — so two seeded channels, sitting still, were
 * invisible forever. What #20 teaches about doors is the other half of that commit:
 * "the HTTP shell route is the one a browser actually bootstraps from … so wiring the
 * socket alone fixes nothing a user can see." Fixing one door is not fixing a feature.
 *
 * So the decisions live here, once, and each transport does nothing but decode, call
 * this, and encode. A new door either calls it or visibly does not — which is the PM's
 * condition on this work, N sites and N tests.
 *
 * @module channelPosts
 */
import {
  ChannelId,
  type OrchestrationChannelPost,
  type OrchestrationChannelPostPage,
  type OrchestrationChannelPostWake,
  type OrchestrationChannelPostPageRequest,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import {
  ProjectionChannelRepository,
  type ChannelMemberRef,
  type ProjectionChannelPost,
} from "../persistence/Services/ProjectionChannels.ts";
import * as Result from "effect/Result";

import {
  channelPostOverFetch,
  decodeChannelCursor,
  type ChannelPostDirection,
  resolveChannelPostPage,
} from "./channelCursor.ts";
import { wakesForPosts } from "./channelPostWakes.ts";
import type { ChannelPostWakeRepository } from "../persistence/Services/ChannelPostWakes.ts";
import type { ProjectionTurnRepository } from "../persistence/Services/ProjectionTurns.ts";

/**
 * The caller asked for a channel it is not in, or one that does not exist.
 *
 * THE TWO ARE ONE ANSWER, deliberately. Distinguishing them tells a caller the
 * names of channels it cannot read, which is the disclosure `listChannelsForMember`
 * pushes into the query rather than into a caller's discretion. `getChannelByName`
 * conflates the same pair for the same reason.
 */
export class ChannelPostsUnreadable extends Schema.TaggedError<ChannelPostsUnreadable>()(
  "ChannelPostsUnreadable",
  { channelId: ChannelId },
) {}

/**
 * The cursor was not issued by this channel.
 *
 * A REFUSAL, NEVER AN EMPTY PAGE, and every door has to keep it one: an empty page
 * is the answer for "you are caught up". `decodeChannelCursor` has the account.
 */
export class ChannelCursorRejected extends Schema.TaggedError<ChannelCursorRejected>()(
  "ChannelCursorRejected",
  { channelId: ChannelId, cursor: Schema.String },
) {}

const toPost = (
  row: ProjectionChannelPost,
  wakes: ReadonlyArray<OrchestrationChannelPostWake> | undefined,
): OrchestrationChannelPost => ({
  id: row.postId,
  channelId: row.channelId,
  sequence: row.sequence,
  authorHandle: row.authorHandle,
  body: row.body,
  mentions: row.mentions,
  parentPostId: row.parentPostId,
  createdAt: row.createdAt,
  // SPREAD, NOT ASSIGNED: `wakes: undefined` is a present key with an undefined
  // value, which the schema's `optional` admits but a JSON encoder drops and a
  // deep-equal assertion does not — so the wire and the test would disagree
  // about the same post. Absent means absent.
  ...(wakes === undefined ? {} : { wakes }),
});

/**
 * One page, for the member who asked.
 *
 * MEMBERSHIP IS CHECKED HERE and not in a transport, for the reason
 * `listChannelsForMember`'s docstring gives about its own query: a rule a caller
 * is trusted to apply is a rule in a file that cannot enforce it, and it is one
 * careless handler away from being untrue.
 *
 * IT OVER-FETCHES BY ONE to decide whether a further page exists, which is how
 * `nextCursor: null` comes to mean "the end" rather than "probably the end". The
 * extra row is dropped from the END going forward and from the FRONT going
 * backward, because backward's window is chosen from the newest end — and the
 * rows arrive ascending in both directions, so "the extra one" is at a different
 * end than the naive reading suggests. That asymmetry is the off-by-one a fixture
 * whose page size equals its row count cannot see.
 */
export function readChannelPostPage(input: {
  readonly request: OrchestrationChannelPostPageRequest;
  readonly member: ChannelMemberRef;
}): Effect.Effect<
  OrchestrationChannelPostPage,
  ChannelPostsUnreadable | ChannelCursorRejected | ProjectionRepositoryError,
  ProjectionChannelRepository | ChannelPostWakeRepository | ProjectionTurnRepository
> {
  return Effect.gen(function* () {
    const projectionChannels = yield* ProjectionChannelRepository;
    const { channelId, direction, limit, cursor } = input.request;

    // MEMBERSHIP FIRST, before the cursor is even examined. A caller holding a
    // foreign cursor for a channel it is not in must not be able to tell the two
    // refusals apart: `ChannelCursorRejected` would confirm the channel exists.
    const channels = yield* projectionChannels.listChannelsForMember(input.member);
    if (!channels.some((row) => row.channelId === channelId)) {
      return yield* new ChannelPostsUnreadable({ channelId });
    }

    const at = yield* resolveCursor(channelId, direction, cursor);

    const overFetch = channelPostOverFetch(limit);
    const rows =
      direction === "backward"
        ? yield* projectionChannels.listPostsBackward({
            channelId,
            limit: overFetch,
            beforeSequence: Option.getOrUndefined(at),
          })
        : yield* projectionChannels.listPosts({
            channelId,
            limit: overFetch,
            afterSequence: Option.getOrUndefined(at),
          });

    // Shared with the comms gateway, beside the codec: over-fetch, which end to
    // drop, which row the cursor comes off and whether a next page exists are
    // decisions about the cursor format, and this door held its own copy of all
    // four in a different style from the other door's.
    const page = resolveChannelPostPage({ channelId, direction, limit, rows });
    // AFTER the page is cut, not before: the over-fetched row is not returned
    // and its wakes are not the caller's business.
    const wakes = yield* wakesForPosts({
      channelId,
      postIds: page.rows.map((row) => row.postId),
    });
    return {
      channelId,
      posts: page.rows.map((row) => toPost(row, wakes.get(row.postId))),
      nextCursor: page.nextCursor,
    };
  });
}

const resolveCursor = (
  channelId: ChannelId,
  // THE DIRECTION IS PART OF THE CURSOR'S IDENTITY, so it has to reach the
  // decoder: a cursor points AFTER its page going forward and BEFORE it going
  // backward, and one used in the other direction is refused rather than
  // answered with a page (`t3_bot-2oh`).
  direction: ChannelPostDirection,
  cursor: string | undefined,
): Effect.Effect<Option.Option<number>, ChannelCursorRejected> => {
  if (cursor === undefined) {
    return Effect.succeed(Option.none<number>());
  }
  const decoded = decodeChannelCursor(channelId, direction, cursor);
  // THE REASON IS DROPPED HERE, and only here. `ChannelCursorRejected` crosses the
  // wire as `OrchestrationChannelCursorRejectedError`, so carrying the reason means
  // widening a contract, the ws mapping and whatever the clients render — a change
  // to the browser's error, not to this cursor. The comms toolkit, whose refusal is
  // a SENTENCE an agent has to act on, does carry it (`CommsCursorUnusableError`).
  return Result.isFailure(decoded)
    ? Effect.fail(new ChannelCursorRejected({ channelId, cursor }))
    : Effect.succeed(Option.some(decoded.success));
};
