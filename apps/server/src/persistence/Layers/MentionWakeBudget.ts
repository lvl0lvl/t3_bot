import { IsoDateTime } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  MentionWakeBudgetRepository,
  MentionWakeSuppression,
  type MentionWakeBudgetRepositoryShape,
} from "../Services/MentionWakeBudget.ts";

const ChannelWindowInput = Schema.Struct({
  channelId: Schema.String,
  windowStart: IsoDateTime,
});

const ChannelInput = Schema.Struct({ channelId: Schema.String });

const CountRow = Schema.Struct({ count: Schema.Number });

const makeMentionWakeBudgetRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertWakeRow = SqlSchema.void({
    Request: Schema.Struct({
      channelId: Schema.String,
      postId: Schema.String,
      wokenAt: IsoDateTime,
    }),
    // OR IGNORE, not an upsert: a replayed post must not move `woken_at`
    // forward. Sliding the timestamp on every replay would let a post that was
    // paid for ten minutes ago re-enter the window and push a live wake out of
    // it, so the same traffic would be counted differently depending on when
    // the server last crashed.
    execute: ({ channelId, postId, wokenAt }) => sql`
      INSERT OR IGNORE INTO mention_wake_budget (channel_id, post_id, woken_at)
      VALUES (${channelId}, ${postId}, ${wokenAt})
    `,
  });

  const pruneWakeRows = SqlSchema.void({
    Request: Schema.Struct({ retentionStart: IsoDateTime }),
    // ACROSS ALL CHANNELS, not just the one being written. A row outside the
    // window can never change a decision, and pruning only the writer's channel
    // leaves a channel that has gone quiet holding its last twenty rows
    // forever — the table would then grow with the number of channels that have
    // ever been busy rather than with the traffic of the last ten minutes.
    execute: ({ retentionStart }) => sql`
      DELETE FROM mention_wake_budget WHERE woken_at < ${retentionStart}
    `,
  });

  const countWakeRows = SqlSchema.findOne({
    Request: ChannelWindowInput,
    Result: CountRow,
    execute: ({ channelId, windowStart }) => sql`
      SELECT COUNT(*) AS count
      FROM mention_wake_budget
      WHERE channel_id = ${channelId} AND woken_at >= ${windowStart}
    `,
  });

  const getSuppressionRow = SqlSchema.findOneOption({
    Request: ChannelInput,
    Result: MentionWakeSuppression,
    execute: ({ channelId }) => sql`
      SELECT
        channel_id AS "channelId",
        exhausted_at AS "exhaustedAt",
        suppressed_count AS "suppressedCount"
      FROM mention_wake_suppressed
      WHERE channel_id = ${channelId}
    `,
  });

  const suppressRow = SqlSchema.findOne({
    Request: Schema.Struct({ channelId: Schema.String, at: IsoDateTime }),
    Result: MentionWakeSuppression,
    // ONE STATEMENT, so latching and counting cannot interleave. The conflict
    // branch deliberately does NOT touch `exhausted_at`: the ERROR line reports
    // how long the channel has been stopped, and a field that moved with every
    // refusal would always read "just now".
    execute: ({ channelId, at }) => sql`
      INSERT INTO mention_wake_suppressed (channel_id, exhausted_at, suppressed_count)
      VALUES (${channelId}, ${at}, 1)
      ON CONFLICT (channel_id)
      DO UPDATE SET suppressed_count = suppressed_count + 1
      RETURNING
        channel_id AS "channelId",
        exhausted_at AS "exhaustedAt",
        suppressed_count AS "suppressedCount"
    `,
  });

  const clearWakeRows = SqlSchema.void({
    Request: ChannelInput,
    execute: ({ channelId }) => sql`
      DELETE FROM mention_wake_budget WHERE channel_id = ${channelId}
    `,
  });

  const clearSuppressionRow = SqlSchema.void({
    Request: ChannelInput,
    execute: ({ channelId }) => sql`
      DELETE FROM mention_wake_suppressed WHERE channel_id = ${channelId}
    `,
  });

  const spend: MentionWakeBudgetRepositoryShape["spend"] = (input) =>
    Effect.gen(function* () {
      // AFTER the insert and the count, and on RETENTION rather than on the
      // window — see the service docstring. Pruning first, on the window,
      // deleted the row `INSERT OR IGNORE` depends on and re-charged every
      // replayed post at once.
      yield* insertWakeRow({
        channelId: input.channelId,
        postId: input.postId,
        wokenAt: input.wokenAt,
      });
      const row = yield* countWakeRows({
        channelId: input.channelId,
        windowStart: input.windowStart,
      });
      yield* pruneWakeRows({ retentionStart: input.retentionStart });
      return row.count;
    }).pipe(Effect.mapError(toPersistenceSqlError("MentionWakeBudgetRepository.spend:query")));

  const countSince: MentionWakeBudgetRepositoryShape["countSince"] = (input) =>
    countWakeRows(input).pipe(
      Effect.map((row) => row.count),
      Effect.mapError(toPersistenceSqlError("MentionWakeBudgetRepository.countSince:query")),
    );

  const getSuppression: MentionWakeBudgetRepositoryShape["getSuppression"] = (input) =>
    getSuppressionRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("MentionWakeBudgetRepository.getSuppression:query")),
    );

  const suppress: MentionWakeBudgetRepositoryShape["suppress"] = (input) =>
    suppressRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("MentionWakeBudgetRepository.suppress:query")),
    );

  const clear: MentionWakeBudgetRepositoryShape["clear"] = (input) =>
    Effect.gen(function* () {
      yield* clearWakeRows(input);
      yield* clearSuppressionRow(input);
    }).pipe(Effect.mapError(toPersistenceSqlError("MentionWakeBudgetRepository.clear:query")));

  return {
    spend,
    countSince,
    getSuppression,
    suppress,
    clear,
  } satisfies MentionWakeBudgetRepositoryShape;
});

export const MentionWakeBudgetRepositoryLive = Layer.effect(
  MentionWakeBudgetRepository,
  makeMentionWakeBudgetRepository,
);
