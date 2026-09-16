import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Which event types and aggregate kinds the build that ran the projectors
 * could decode, and over which stretch of the log it ran them.
 *
 * Since #79 the event store skips a row whose type or kind this build does
 * not know, and the projector watermark then crosses that row for good: the
 * build that later knows the type resumes from the same watermark and never
 * applies it. Nothing in the log says a row was skipped, and a warning is not
 * durable. This table is the durable half: one row per DECODER EPOCH, the
 * lists a build could decode and the (started, ended] watermark range it
 * applied with them. A later build whose lists are larger scans each epoch's
 * range for rows of a type or kind that epoch lacked; a hit is a hole, and
 * the repair is a rebuild from 0 by the fresh-install path.
 *
 * ONE ROW PER EPOCH RATHER THAN ONE ROW OVERWRITTEN, because the sequence
 * new -> old -> new is the case that makes the ledger work: the old build
 * writes its own smaller lists over its own range, and only that range can
 * hold its holes. Overwriting would lose the range of every earlier epoch,
 * and a build older than the previous one (new -> old -> older -> new) would
 * leave the middle epoch's holes unscanned. A rebuild re-applies the whole
 * log, so it may delete every epoch and start one of its own.
 *
 * The lists are JSON arrays of the schema literals, read from the schemas'
 * AST at bootstrap, so the table and the union cannot drift.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_decoder (
      epoch INTEGER PRIMARY KEY AUTOINCREMENT,
      event_types_json TEXT NOT NULL,
      aggregate_kinds_json TEXT NOT NULL,
      started_at_sequence INTEGER NOT NULL,
      ended_at_sequence INTEGER NOT NULL
    )
  `;
});
