import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Which turn answered a channel post, kept under the POST's key.
 *
 * The link already exists for an instant and is then destroyed. A wake stages a
 * pending turn-start row whose messageId is the post-derived `wakeKey`; the next
 * `thread.session-set` writes that key onto the turn row and deletes the staging
 * row. But the turn row takes it only if it has none yet - upstream's `??`, the
 * "message that started this turn" rule that the user-turn walk reads - so on a
 * thread that is already running, the FIRST post keeps the turn row and every
 * later post's key is deleted with the staging row and exists nowhere
 * (`t3_bot-j6o`, measured in `MentionWakeReactor.test.ts`).
 *
 * This table is written at that delete, from the two halves that are both in
 * hand there: the staging row's key and the turnId the session-set carries. It
 * is a CAPTURE, not a reconstruction — the distinction the bead's corrections
 * insist on, because the staging row read at any later moment answers for
 * whichever post most recently had no turn, which is not a correlation at all.
 *
 * A NEW TABLE RATHER THAN A COLUMN, because it is a new fact rather than a
 * property of a row that already means something else. The turn row means "this
 * turn"; hanging a second post's key on it would either overwrite the starter or
 * make the column a list, and that column is read app-wide by the user-turn
 * walk.
 *
 * KEYED BY (channel, post, THREAD), and the third part is the one that is easy
 * to leave out. One post can wake several threads: `MentionWakeReactor.wake`
 * resolves `threadIds` plural and dispatches one turn start per thread, each
 * with its own `wakeKey`. A key of (channel, post) would hold one of them and
 * discard the rest — a per-post fact answering for a thread the reader did not
 * ask about, which is this bead's own defect one layer up.
 *
 * `channel_id` and `post_id` ARE COLUMNS rather than being left inside the key
 * string, because the read goes the other way: a reader holds a post and wants
 * its wakes, and the key's third part is the thread it is trying to find. The
 * writer recovers them with `parseWakeKey`, which lives beside `wakeKey` so the
 * format has one home.
 *
 * NO OUTCOME COLUMN. What became of the turn is the turn row's business and is
 * resolved at read time; copying it here would be a second copy of a value that
 * changes after this row is written, and it would be stale from the moment the
 * turn ended.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS channel_post_wake (
      channel_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      -- When the link was captured, which is the session-set that consumed the
      -- staging row rather than when the post was written. Two posts folded into
      -- one turn are captured at different moments and both are true.
      linked_at TEXT NOT NULL,
      PRIMARY KEY (channel_id, post_id, thread_id)
    )
  `;

  // The read is "the wakes for these posts in this channel", one page of posts
  // at a time. The primary key serves it — its leading columns are the channel
  // and the post — so no second index is created for a query that does not
  // exist yet.
  //
  // The other direction, "which posts did this turn answer", is what a
  // cancellation would ask. It has no caller today and would need
  // (thread_id, turn_id); it is deliberately not created until something reads
  // it, because an index nobody queries is maintained on every wake for nothing.
});
