import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The per-channel wake budget: a rolling window of wakes, and a latch that
 * holds a channel stopped once it has spent them.
 *
 * TWO TABLES BECAUSE THERE ARE TWO PIECES OF STATE, and the first version of
 * this migration modelled only the window. A rolling window on its own does not
 * do what the feature says: it refills. Two agents mentioning each other spend
 * the budget, go quiet for ten minutes, and resume — forever, at a reduced
 * rate. `t3_bot-64d` asks for "stop and say so loudly" rather than "throttle
 * silently", and 20 wakes every 10 minutes sustained is 2,880 unattended turns
 * a day, which is the cost the bead exists to bound. So exhaustion LATCHES, and
 * the way out is a human post. The window decides what counts as exhausted; the
 * latch decides how long it lasts. Neither can be derived from the other once
 * the timestamps age out of the window.
 *
 * ITS OWN TABLES RATHER THAN `projection_state`, which was the first choice:
 * that row holds a single `lastAppliedSequence` integer, and a true rolling
 * window needs the individual timestamps. A `{ count, windowStartedAt }` pair
 * fits in one integer and is a FIXED window — it admits two full budgets across
 * a boundary, twenty at the end of one window and twenty at the start of the
 * next, while the ERROR log says the budget was never exceeded. The log line has
 * to name the window and the budget truthfully, and this is the only shape where
 * the sentence a human reads and the thing the code did are the same.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS mention_wake_budget (
      channel_id TEXT NOT NULL,
      -- KEYED BY THE POST, not merely stamped with a time, and that is what
      -- makes the count survive this reactor's own design. Its cursor lags
      -- deliberately — it advances after the wake, so a crash between the two
      -- replays the post, and the derived commandId absorbs the duplicate
      -- dispatch. Nothing absorbs a duplicate ROW. With a bare timestamp every
      -- held-cursor replay spends the budget again, and a channel that never
      -- exceeded it gets latched off by the replay of wakes it already paid
      -- for. INSERT OR IGNORE on this key makes the spend idempotent, which
      -- also lets it be written BEFORE the dispatch, where the decision is.
      post_id TEXT NOT NULL,
      -- The wake's own time, not the post's. A backlog replayed after a restart
      -- wakes now, and it is the waking that this bounds: a thousand posts
      -- landing while the reactor was down must not be able to spend a thousand
      -- wakes the instant it comes back, which is what the post's occurredAt
      -- would allow, since all thousand fall outside the window.
      woken_at TEXT NOT NULL,
      PRIMARY KEY (channel_id, post_id)
    )
  `;

  // The decision reads "wakes for this channel since T". The primary key does
  // not serve it — it orders by post id — so the window gets its own index.
  // Pruning is by time across all channels and is a scan; at a few hundred rows
  // that is cheaper than a third index to maintain on every wake.
  yield* sql`
    CREATE INDEX IF NOT EXISTS mention_wake_budget_channel_time
      ON mention_wake_budget (channel_id, woken_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS mention_wake_suppressed (
      channel_id TEXT PRIMARY KEY,
      exhausted_at TEXT NOT NULL,
      -- Persisted rather than counted in memory so the ERROR line stays true
      -- across a restart. A crash-loop is the runaway most worth bounding, and
      -- a tally that resets on every boot reports "1 suppressed" forever while
      -- thousands were refused.
      suppressed_count INTEGER NOT NULL
    )
  `;
});
