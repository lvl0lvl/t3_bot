import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The channel projection the comms gateway reads.
 *
 * Indexes follow the four questions `ChannelGatewayShape` asks, not the shape
 * of the entities: a channel is looked up by NAME together with a membership
 * test, a post by id scoped to its channel, and a page of posts in ascending
 * sequence from an opaque cursor.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_channels (
      channel_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  // getChannelForMember resolves by name. Unique because a mention names one
  // channel, and two channels answering to "#seniors" makes that ambiguous.
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS projection_channels_name
      ON projection_channels (name)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_channel_members (
      channel_id TEXT NOT NULL,
      handle TEXT NOT NULL,
      member_kind TEXT NOT NULL,
      member_id TEXT NOT NULL,
      PRIMARY KEY (channel_id, handle)
    )
  `;

  // The one place member_id is the right key: getChannelForMember asks whether
  // a given thread is a member, and mentions resolve the other way by handle
  // (already covered by the primary key).
  yield* sql`
    CREATE INDEX IF NOT EXISTS projection_channel_members_member
      ON projection_channel_members (member_kind, member_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_channel_posts (
      post_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      author_handle TEXT NOT NULL,
      body TEXT NOT NULL,
      mentions_json TEXT NOT NULL,
      parent_post_id TEXT,
      created_at TEXT NOT NULL
    )
  `;

  // readPosts pages oldest-first by sequence within one channel, and the
  // opaque cursor encodes that sequence, so the range scan is this index.
  yield* sql`
    CREATE INDEX IF NOT EXISTS projection_channel_posts_channel_sequence
      ON projection_channel_posts (channel_id, sequence)
  `;
});
