import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ChannelPostWake,
  ChannelPostWakeRepository,
  type ChannelPostWakeRepositoryShape,
} from "../Services/ChannelPostWakes.ts";

const makeChannelPostWakeRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const linkRow = SqlSchema.void({
    Request: ChannelPostWake,
    // UPSERT ON THE TRIPLE, and the conflict target is the whole primary key so
    // a post that woke two threads keeps two rows. The projector replays, so the
    // second write of a link it already holds must be the same fact rather than
    // a constraint failure.
    //
    // `turn_id` IS OVERWRITTEN, which is the opposite of the turn row's `??` and
    // deliberately so: that rule keeps the message that STARTED a turn, and this
    // row answers which turn ANSWERED a post. Opposite questions, opposite
    // last-write rules. `linked_at` moves with it so the pair stays coherent —
    // a timestamp describing a turn id it was not written with is worse than no
    // timestamp.
    execute: ({ channelId, postId, threadId, turnId, linkedAt }) => sql`
      INSERT INTO channel_post_wake (channel_id, post_id, thread_id, turn_id, linked_at)
      VALUES (${channelId}, ${postId}, ${threadId}, ${turnId}, ${linkedAt})
      ON CONFLICT (channel_id, post_id, thread_id) DO UPDATE SET
        turn_id = excluded.turn_id,
        linked_at = excluded.linked_at
    `,
  });

  const selectByPostIds = SqlSchema.findAll({
    Request: Schema.Struct({
      channelId: Schema.String,
      postIds: Schema.Array(Schema.String),
    }),
    Result: ChannelPostWake,
    execute: ({ channelId, postIds }) => sql`
      SELECT channel_id, post_id, thread_id, turn_id, linked_at
        FROM channel_post_wake
       WHERE channel_id = ${channelId}
         AND post_id IN ${sql.in(postIds)}
    `,
  });

  const link: ChannelPostWakeRepositoryShape["link"] = (input) =>
    linkRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ChannelPostWakeRepository.link:query")),
    );

  const listByPostIds: ChannelPostWakeRepositoryShape["listByPostIds"] = (input) =>
    // AN EMPTY PAGE ASKS NOTHING. `IN ()` is not valid SQLite, and a page with
    // no posts is an ordinary state — the newest page of an empty channel — so
    // it must not reach the query at all.
    input.postIds.length === 0
      ? Effect.succeed([])
      : selectByPostIds(input).pipe(
          Effect.mapError(toPersistenceSqlError("ChannelPostWakeRepository.listByPostIds:query")),
        );

  return { link, listByPostIds } satisfies ChannelPostWakeRepositoryShape;
});

export const ChannelPostWakeRepositoryLive = Layer.effect(
  ChannelPostWakeRepository,
  makeChannelPostWakeRepository,
);
