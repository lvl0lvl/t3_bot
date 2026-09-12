/**
 * ChannelPostWakeRepository - which turn answered which channel post.
 *
 * The link exists for an instant and is then destroyed, which is the whole
 * reason this table is written at all. A wake stages a pending turn-start row
 * whose messageId is the post-derived `wakeKey`; the next `thread.session-set`
 * copies that key onto the turn row and deletes the staging row. The copy
 * happens only if the turn row has no key yet — upstream's `??`, the "message
 * that started this turn" rule the user-turn walk reads — so on a thread that is
 * already running, the first post keeps the turn row and every later post's key
 * is deleted with the staging row and exists nowhere (`t3_bot-j6o`).
 *
 * A CAPTURE, NEVER A RECONSTRUCTION. This is written at the delete, from the two
 * halves that are both in hand there. Reading the staging row at any later
 * moment does NOT recover the same fact: it answers for whichever post most
 * recently had no turn, and after the delete it answers nothing. The bead's
 * corrections say this in as many words, having been wrong about it twice.
 *
 * NO OUTCOME HERE. What became of the turn is the turn row's business, resolved
 * at read time. A copy of it in this table would be stale from the moment the
 * turn ended, and the read has to join the turn row anyway.
 *
 * @module ChannelPostWakeRepository
 */
import { IsoDateTime, ThreadId, TurnId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

/**
 * One post's wake of one thread.
 *
 * THE THREAD IS PART OF THE IDENTITY, not a detail hanging off the post. A post
 * mentioning two handles wakes two threads — `MentionWakeReactor.wake` resolves
 * `threadIds` plural and dispatches a turn start per thread — and the two turns
 * can end differently. A row per (post, thread) is the only shape in which both
 * are representable; keyed by post alone, one of them silently wins.
 */
export const ChannelPostWake = Schema.Struct({
  channelId: Schema.String,
  postId: Schema.String,
  threadId: ThreadId,
  turnId: TurnId,
  /**
   * When the link was captured — the session-set that consumed the staging row,
   * not when the post was written. Two posts folded into one turn are captured
   * at different moments and both timestamps are true.
   */
  linkedAt: IsoDateTime,
});
export type ChannelPostWake = typeof ChannelPostWake.Type;

export interface ChannelPostWakeRepositoryShape {
  /**
   * Record that `turnId` answered this post's wake of this thread.
   *
   * IDEMPOTENT ON (channel, post, thread), because the projector replays. A
   * projection rebuild walks the same events again and must not fail on a link
   * it already holds; the second write of the same triple is the same fact.
   *
   * LAST WRITE WINS ON `turnId`, which is deliberate and is the opposite of the
   * turn row's `??`. That rule exists so a turn keeps the message that STARTED
   * it. This table answers a different question — which turn answered this post
   * — and if a post's wake were somehow re-linked to a later turn, the later
   * turn is the one that answered it. The two rules point opposite ways because
   * they are about opposite things.
   */
  readonly link: (input: ChannelPostWake) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Every wake for these posts in this channel, for one page of a channel read.
   *
   * TAKES THE PAGE, not one post at a time: the caller is rendering a page and a
   * per-post call would be a query per row. Returns rows, not a map, because the
   * relation is one-to-many and the caller groups them.
   */
  readonly listByPostIds: (input: {
    readonly channelId: string;
    readonly postIds: ReadonlyArray<string>;
  }) => Effect.Effect<ReadonlyArray<ChannelPostWake>, ProjectionRepositoryError>;
}

export class ChannelPostWakeRepository extends Context.Service<
  ChannelPostWakeRepository,
  ChannelPostWakeRepositoryShape
>()("t3/persistence/Services/ChannelPostWakes/ChannelPostWakeRepository") {}
