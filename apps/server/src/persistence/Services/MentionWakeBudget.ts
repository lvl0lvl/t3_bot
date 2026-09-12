/**
 * MentionWakeBudgetRepository - the per-channel wake budget's storage.
 *
 * Two pieces of state, because a rolling window alone refills and the feature
 * is a stop rather than a throttle (see migration 052): the wakes inside the
 * current window, and the latch that holds a channel stopped once it has spent
 * them. The policy — how many, how long, what to log — is NOT here; it lives
 * with the reactor that makes the decision, so this stays a repository.
 *
 * PERSISTED, and that answers `t3_bot-64d`'s criterion 5 rather than leaving it
 * to be inferred: an in-memory budget is reset by every boot, so a server in a
 * crash-loop bounds nothing, and a crash-loop is the runaway most worth
 * bounding. Channels are never deleted in this system, only archived, so no row
 * is ever orphaned by a delete; rows for a channel nobody posts in age out of
 * the window and are pruned by the next wake anywhere.
 *
 * @module MentionWakeBudgetRepository
 */
import { IsoDateTime } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

/**
 * A channel that has spent its budget, and what has been refused since.
 *
 * `exhaustedAt` is when the budget was first exceeded, not when the latest wake
 * was refused — the ERROR line needs to say how long the channel has been
 * stopped, and a field that moved with every refusal could never answer that.
 */
export const MentionWakeSuppression = Schema.Struct({
  channelId: Schema.String,
  exhaustedAt: IsoDateTime,
  suppressedCount: Schema.Number,
});
export type MentionWakeSuppression = typeof MentionWakeSuppression.Type;

export interface MentionWakeBudgetRepositoryShape {
  /**
   * Spend one wake for `channelId`, attributed to `postId`, and report how many
   * wakes now sit inside the window that starts at `windowStart`.
   *
   * IDEMPOTENT PER POST, which is what makes the count correct under this
   * reactor's replay. The cursor advances after the wake, so a crash between
   * the two replays the post; a second spend for a post already recorded is
   * ignored, and the returned count is the same one the first spend saw.
   *
   * Also prunes every row older than `windowStart`, across all channels — rows
   * outside the window can never change any decision, and pruning here rather
   * than in a caller means the only writer is the only pruner. The table is
   * therefore bounded by the wakes of the last window, not by history.
   *
   * The count INCLUDES this spend, so a caller comparing it against a budget is
   * asking "would this wake be the one that exceeds it".
   */
  readonly spend: (input: {
    readonly channelId: string;
    readonly postId: string;
    readonly wokenAt: IsoDateTime;
    readonly windowStart: IsoDateTime;
  }) => Effect.Effect<number, ProjectionRepositoryError>;

  /**
   * The channel's latch, if it is stopped.
   */
  readonly getSuppression: (input: {
    readonly channelId: string;
  }) => Effect.Effect<Option.Option<MentionWakeSuppression>, ProjectionRepositoryError>;

  /**
   * Latch the channel off, or count one more refusal against an existing latch,
   * and report the latch as it now stands.
   *
   * One call rather than a read and a write, so two fibers cannot both read
   * "not yet exhausted" and both write an `exhaustedAt`. The reactor's worker is
   * a single fiber today; this does not depend on that staying true.
   */
  readonly suppress: (input: {
    readonly channelId: string;
    readonly at: IsoDateTime;
  }) => Effect.Effect<MentionWakeSuppression, ProjectionRepositoryError>;

  /**
   * Forget everything about a channel: the spent wakes and the latch.
   *
   * The human-post reset. Both, because a half-reset that cleared the latch but
   * kept the window would re-latch on the next wake for reasons nobody could
   * reconstruct from the log.
   */
  readonly clear: (input: {
    readonly channelId: string;
  }) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Wakes for a channel inside the window. Exported for tests and for anything
   * that wants to report a channel's headroom without spending any of it.
   */
  readonly countSince: (input: {
    readonly channelId: string;
    readonly windowStart: IsoDateTime;
  }) => Effect.Effect<number, ProjectionRepositoryError>;
}

export class MentionWakeBudgetRepository extends Context.Service<
  MentionWakeBudgetRepository,
  MentionWakeBudgetRepositoryShape
>()("t3/persistence/Services/MentionWakeBudget/MentionWakeBudgetRepository") {}
