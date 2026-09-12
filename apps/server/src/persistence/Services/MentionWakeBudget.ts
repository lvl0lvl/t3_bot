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
   * Also prunes, across all channels — but on `retentionStart`, NOT on
   * `windowStart`, and the gap between them is the whole of what makes the
   * idempotence above true.
   *
   * PRUNING ON THE WINDOW DESTROYED THE THING THE POST KEY RELIES ON. `INSERT
   * OR IGNORE` is only idempotent while the post's row still EXISTS, so a
   * window-width prune left the key buying idempotence only INSIDE the window —
   * where a replay was harmless anyway — and nothing outside it, which is
   * exactly where a restart lands. A review lane proved it: one held post, 15
   * wakes, ten minutes of ageing, restart, and 16 rows sat in a window whose
   * correct count is 1. The channel then latched after four more legitimate
   * posts instead of nineteen — verbatim the failure this key exists to
   * prevent.
   *
   * So a row outlives the window by the retention margin, and the count still
   * only sees the window. The table is bounded by the wakes of the retention
   * period rather than of the window; retention is the caller's to choose and
   * the reactor's constant says why.
   *
   * The count INCLUDES this spend, so a caller comparing it against a budget is
   * asking "would this wake be the one that exceeds it".
   */
  readonly spend: (input: {
    readonly channelId: string;
    readonly postId: string;
    readonly wokenAt: IsoDateTime;
    /** Rows at or after this are counted. */
    readonly windowStart: IsoDateTime;
    /** Rows before this are deleted. Must be older than `windowStart`. */
    readonly retentionStart: IsoDateTime;
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
}

export class MentionWakeBudgetRepository extends Context.Service<
  MentionWakeBudgetRepository,
  MentionWakeBudgetRepositoryShape
>()("t3/persistence/Services/MentionWakeBudget/MentionWakeBudgetRepository") {}
