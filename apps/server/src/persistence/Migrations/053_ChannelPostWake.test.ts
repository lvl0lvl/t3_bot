import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("053_ChannelPostWake", (it) => {
  it.effect("keys a link by thread as well as by post, so one post can wake two", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 53 });

      // THE PROPERTY THE TABLE EXISTS FOR, asserted against the SCHEMA rather
      // than through the repository: a primary key of (channel, post) would
      // accept the first row and refuse the second, and the repository's
      // upsert would then quietly turn "two threads" into "last thread wins".
      // A test through the repository could not tell that from a correct key.
      yield* sql`
        INSERT INTO channel_post_wake (channel_id, post_id, thread_id, turn_id, linked_at)
        VALUES ('channel-a', 'post-1', 'thread-x', 'turn-x', '2026-01-01T00:00:00.000Z')
      `;
      yield* sql`
        INSERT INTO channel_post_wake (channel_id, post_id, thread_id, turn_id, linked_at)
        VALUES ('channel-a', 'post-1', 'thread-y', 'turn-y', '2026-01-01T00:00:00.000Z')
      `;

      const rows = yield* sql<{ readonly thread_id: string; readonly turn_id: string }>`
        SELECT thread_id, turn_id FROM channel_post_wake
        WHERE channel_id = 'channel-a' AND post_id = 'post-1'
        ORDER BY thread_id
      `;
      assert.deepStrictEqual(
        rows.map((r) => [r.thread_id, r.turn_id]),
        [
          ["thread-x", "turn-x"],
          ["thread-y", "turn-y"],
        ],
      );

      // AND THE SAME TRIPLE TWICE IS A CONFLICT, not a third row: that is what
      // the repository's ON CONFLICT clause is written against, and a key that
      // did not include all three columns would either refuse the second
      // thread above or admit a duplicate here.
      // PARENTHESISED, because a tagged template followed by `.pipe(...)`
      // parses as the tag called twice — once with the template and once
      // with the pipe's argument — and the second call sees a function where
      // it expected strings.
      const refused = yield* Effect.flip(sql`
        INSERT INTO channel_post_wake (channel_id, post_id, thread_id, turn_id, linked_at)
        VALUES ('channel-a', 'post-1', 'thread-x', 'turn-x', '2026-01-01T00:00:00.000Z')
      `);
      assert.isDefined(refused);
    }),
  );
});
