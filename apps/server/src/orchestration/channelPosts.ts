/**
 * One page of a channel's posts, for every client door.
 *
 * ONE HANDLER, TWO THIN TRANSPORTS, and that is the shape rather than a
 * preference. `#19` exists because `ClientOrchestrationCommand` is the payload of
 * both the WebSocket RPC and `POST /api/orchestration/dispatch`, and a change
 * taught one of them to stamp an issuer: a guard wired at two call sites and
 * present at one. `#20` exists because the shell snapshot reaches the client
 * through both `subscribeShell` and `GET /api/orchestration/shell`, and only the
 * socket was given channels — while the browser bootstraps over HTTP, so the
 * sidebar was permanently empty and every socket-side test passed.
 *
 * Twice is a pattern. So the decisions live here, once, and each transport does
 * nothing but decode, call this, and encode. A new door either calls it or
 * visibly does not.
 *
 * @module channelPosts
 */
import {
  ChannelId,
  type OrchestrationChannelPost,
  type OrchestrationChannelPostPage,
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
import { decodeChannelCursor, encodeChannelCursor } from "./channelCursor.ts";

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
 * A REFUSAL, NEVER AN EMPTY PAGE. The empty page is byte for byte what "you are
 * caught up" looks like, so answering with one is the defect `t3_bot-e60` was
 * filed for — a cursor earned in one channel reported a second channel with three
 * unread posts as caught up, and nothing in the reply said otherwise.
 */
export class ChannelCursorRejected extends Schema.TaggedError<ChannelCursorRejected>()(
  "ChannelCursorRejected",
  { channelId: ChannelId, cursor: Schema.String },
) {}

const toPost = (row: ProjectionChannelPost): OrchestrationChannelPost => ({
  id: row.postId,
  channelId: row.channelId,
  sequence: row.sequence,
  authorHandle: row.authorHandle,
  body: row.body,
  mentions: row.mentions,
  parentPostId: row.parentPostId,
  createdAt: row.createdAt,
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
  ProjectionChannelRepository
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

    const at = yield* resolveCursor(channelId, cursor);

    // One more than asked for, to answer "is there another page" rather than
    // guess at it.
    const overFetch = limit + 1;
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

    const more = rows.length === overFetch;
    // BACKWARD DROPS FROM THE FRONT. Both reads return ASCENDING, so going
    // backward the over-fetched row is the OLDEST one — dropping from the end
    // there would discard the newest post and show a channel one post behind.
    const page = more ? (direction === "backward" ? rows.slice(1) : rows.slice(0, limit)) : rows;

    // The cursor points where the next read continues FROM: before the first row
    // going backward, after the last going forward. `null` when this page reached
    // the end in that direction.
    const edge = direction === "backward" ? page[0] : page[page.length - 1];
    return {
      channelId,
      posts: page.map(toPost),
      nextCursor: more && edge !== undefined ? encodeChannelCursor(channelId, edge.sequence) : null,
    };
  });
}

const resolveCursor = (
  channelId: ChannelId,
  cursor: string | undefined,
): Effect.Effect<Option.Option<number>, ChannelCursorRejected> => {
  if (cursor === undefined) {
    return Effect.succeed(Option.none<number>());
  }
  const decoded = decodeChannelCursor(channelId, cursor);
  return Option.isNone(decoded)
    ? Effect.fail(new ChannelCursorRejected({ channelId, cursor }))
    : Effect.succeed(decoded);
};
