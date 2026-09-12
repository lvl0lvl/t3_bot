import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { ChannelId, ChannelMemberHandle, IsoDateTime } from "@t3tools/contracts";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionChannelPost,
  ProjectionChannelRepository,
  type ProjectionChannelRepositoryShape,
} from "../Services/ProjectionChannels.ts";

/** Members live in their own table, so the channel row carries none. */
const ProjectionChannelRow = Schema.Struct({
  channelId: ChannelId,
  name: Schema.String,
  archivedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
type ProjectionChannelRow = typeof ProjectionChannelRow.Type;

/**
 * The same row plus the aggregate. `members` is not here: it comes from a second
 * query per channel rather than a second join, because joining membership as
 * well would multiply the post rows by the member rows and turn MAX into a
 * correct answer computed the expensive way.
 */
const ProjectionChannelWithActivityRow = ProjectionChannelRow.mapFields(
  Struct.assign({ latestPostAt: Schema.NullOr(IsoDateTime) }),
);

const ProjectionChannelMemberRow = Schema.Struct({
  handle: ChannelMemberHandle,
  memberKind: Schema.Literals(["thread", "human"]),
  memberId: Schema.String,
});

const ProjectionChannelPostDbRow = ProjectionChannelPost.mapFields(
  Struct.assign({
    mentions: Schema.fromJsonString(Schema.Array(ChannelMemberHandle)),
  }),
);

const makeProjectionChannelRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertChannelRow = SqlSchema.void({
    Request: ProjectionChannelRow,
    execute: (row) =>
      sql`
        INSERT INTO projection_channels (
          channel_id,
          name,
          archived_at,
          created_at,
          updated_at
        )
        VALUES (
          ${row.channelId},
          ${row.name},
          ${row.archivedAt},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (channel_id)
        DO UPDATE SET
          name = excluded.name,
          archived_at = excluded.archived_at,
          updated_at = excluded.updated_at
      `,
  });

  const selectChannelColumns = sql`
    SELECT
      channel_id AS "channelId",
      name,
      archived_at AS "archivedAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM projection_channels
  `;

  const findChannelByName = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: ProjectionChannelRow,
    execute: (name) => sql`${selectChannelColumns} WHERE name = ${name}`,
  });

  const findChannelById = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: ProjectionChannelRow,
    execute: (channelId) => sql`${selectChannelColumns} WHERE channel_id = ${channelId}`,
  });

  const listMemberRows = SqlSchema.findAll({
    Request: Schema.String,
    Result: ProjectionChannelMemberRow,
    execute: (channelId) =>
      sql`
        SELECT
          handle,
          member_kind AS "memberKind",
          member_id AS "memberId"
        FROM projection_channel_members
        WHERE channel_id = ${channelId}
        ORDER BY handle ASC
      `,
  });

  /**
   * The member's channels, with the last post's time, in one statement.
   *
   * A LEFT JOIN so a channel with no posts still comes back — a channel the
   * sidebar cannot see is indistinguishable from one that does not exist, and an
   * inner join would hide every freshly created channel until someone spoke.
   *
   * Ordered here rather than by the caller: the ordering is "most recent
   * activity, then oldest channel", and NULLs sort last under `DESC` in SQLite,
   * which is the wrong end. `COALESCE` to the channel's own creation time makes
   * an empty channel sort by when it appeared.
   */
  const listChannelRowsForMember = SqlSchema.findAll({
    Request: Schema.Struct({ memberKind: Schema.String, memberId: Schema.String }),
    Result: ProjectionChannelWithActivityRow,
    execute: (member) =>
      sql`
        SELECT
          c.channel_id AS "channelId",
          c.name,
          c.archived_at AS "archivedAt",
          MAX(p.created_at) AS "latestPostAt",
          c.created_at AS "createdAt",
          c.updated_at AS "updatedAt"
        FROM projection_channels c
        JOIN projection_channel_members m ON m.channel_id = c.channel_id
        LEFT JOIN projection_channel_posts p ON p.channel_id = c.channel_id
        WHERE m.member_kind = ${member.memberKind} AND m.member_id = ${member.memberId}
        GROUP BY c.channel_id
        ORDER BY COALESCE(MAX(p.created_at), c.created_at) DESC, c.channel_id ASC
      `,
  });

  /**
   * The same projection as `listChannelRowsForMember`, for one channel and
   * without the membership join.
   *
   * The two share their SELECT shape deliberately: a refetch must produce the
   * same fields as the snapshot, or a live update overwrites a real value with
   * a missing one. They are two statements rather than one because the filters
   * differ — `MAX` over a LEFT JOIN needs the GROUP BY either way, and
   * parameterising the WHERE across "by member" and "by id" would make one
   * query that answers neither question clearly.
   */
  const findChannelWithActivityById = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: ProjectionChannelWithActivityRow,
    execute: (channelId) =>
      sql`
        SELECT
          c.channel_id AS "channelId",
          c.name,
          c.archived_at AS "archivedAt",
          MAX(p.created_at) AS "latestPostAt",
          c.created_at AS "createdAt",
          c.updated_at AS "updatedAt"
        FROM projection_channels c
        LEFT JOIN projection_channel_posts p ON p.channel_id = c.channel_id
        WHERE c.channel_id = ${channelId}
        GROUP BY c.channel_id
      `,
  });

  const insertPostRow = SqlSchema.void({
    Request: ProjectionChannelPost,
    execute: (row) =>
      sql`
        INSERT INTO projection_channel_posts (
          post_id,
          channel_id,
          sequence,
          author_handle,
          body,
          mentions_json,
          parent_post_id,
          created_at
        )
        VALUES (
          ${row.postId},
          ${row.channelId},
          ${row.sequence},
          ${row.authorHandle},
          ${row.body},
          ${JSON.stringify(row.mentions)},
          ${row.parentPostId},
          ${row.createdAt}
        )
        -- Idempotent for replay: bootstrap re-projects the same event and must
        -- not duplicate the row. A genuine collision within one channel is
        -- still swallowed here; that is why post ids should be derived rather
        -- than supplied (t3_bot-a44).
        ON CONFLICT (channel_id, post_id) DO NOTHING
      `,
  });

  const selectPostColumns = sql`
    SELECT
      post_id AS "postId",
      channel_id AS "channelId",
      sequence,
      author_handle AS "authorHandle",
      body,
      mentions_json AS "mentions",
      parent_post_id AS "parentPostId",
      created_at AS "createdAt"
    FROM projection_channel_posts
  `;

  const findPostRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ channelId: Schema.String, postId: Schema.String }),
    Result: ProjectionChannelPostDbRow,
    execute: ({ channelId, postId }) =>
      sql`${selectPostColumns} WHERE channel_id = ${channelId} AND post_id = ${postId}`,
  });

  const listPostRows = SqlSchema.findAll({
    Request: Schema.Struct({
      channelId: Schema.String,
      limit: Schema.Number,
      afterSequence: Schema.Number,
    }),
    Result: ProjectionChannelPostDbRow,
    execute: ({ channelId, limit, afterSequence }) =>
      sql`
        ${selectPostColumns}
        WHERE channel_id = ${channelId} AND sequence > ${afterSequence}
        ORDER BY sequence ASC
        LIMIT ${limit}
      `,
  });

  const listPostRowsBackward = SqlSchema.findAll({
    Request: Schema.Struct({
      channelId: Schema.String,
      limit: Schema.Number,
      beforeSequence: Schema.Number,
    }),
    Result: ProjectionChannelPostDbRow,
    // DESCENDING here and reversed by the caller: taking the newest N means
    // ordering from the newest end, and LIMIT applies after ORDER BY. Asking
    // for ASC with a LIMIT would return the OLDEST n rows before the cursor,
    // which is the wrong page rather than the wrong order.
    execute: ({ channelId, limit, beforeSequence }) =>
      sql`
        ${selectPostColumns}
        WHERE channel_id = ${channelId} AND sequence < ${beforeSequence}
        ORDER BY sequence DESC
        LIMIT ${limit}
      `,
  });

  const withMembers = (row: ProjectionChannelRow) =>
    listMemberRows(row.channelId).pipe(Effect.map((members) => ({ ...row, members })));

  const replaceMembers: ProjectionChannelRepositoryShape["replaceMembers"] = ({
    channelId,
    members,
  }) =>
    Effect.gen(function* () {
      yield* sql`DELETE FROM projection_channel_members WHERE channel_id = ${channelId}`;
      for (const member of members) {
        yield* sql`
          INSERT INTO projection_channel_members (channel_id, handle, member_kind, member_id)
          VALUES (${channelId}, ${member.handle}, ${member.memberKind}, ${member.memberId})
        `;
      }
    }).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionChannelRepository.replaceMembers:query")),
    );

  const upsertChannel: ProjectionChannelRepositoryShape["upsertChannel"] = (row) =>
    upsertChannelRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionChannelRepository.upsertChannel:query")),
      Effect.andThen(replaceMembers({ channelId: row.channelId, members: row.members })),
    );

  const hydrate = (found: Option.Option<ProjectionChannelRow>) =>
    Option.isNone(found)
      ? Effect.succeed(Option.none())
      : withMembers(found.value).pipe(Effect.map(Option.some));

  const getChannelByName: ProjectionChannelRepositoryShape["getChannelByName"] = (name) =>
    findChannelByName(name).pipe(
      Effect.flatMap(hydrate),
      Effect.mapError(toPersistenceSqlError("ProjectionChannelRepository.getChannelByName:query")),
    );

  const getChannelById: ProjectionChannelRepositoryShape["getChannelById"] = (channelId) =>
    findChannelById(channelId).pipe(
      Effect.flatMap(hydrate),
      Effect.mapError(toPersistenceSqlError("ProjectionChannelRepository.getChannelById:query")),
    );

  const insertPost: ProjectionChannelRepositoryShape["insertPost"] = (row) =>
    insertPostRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionChannelRepository.insertPost:query")),
    );

  const getPost: ProjectionChannelRepositoryShape["getPost"] = (input) =>
    findPostRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionChannelRepository.getPost:query")),
    );

  const getChannelWithActivityById: ProjectionChannelRepositoryShape["getChannelWithActivityById"] =
    (channelId) =>
      findChannelWithActivityById(channelId).pipe(
        Effect.flatMap((found) =>
          Option.isNone(found)
            ? Effect.succeed(Option.none())
            : listMemberRows(found.value.channelId).pipe(
                Effect.map((members) => Option.some({ ...found.value, members })),
              ),
        ),
        Effect.mapError(
          toPersistenceSqlError("ProjectionChannelRepository.getChannelWithActivityById:query"),
        ),
      );

  const listChannelsForMember: ProjectionChannelRepositoryShape["listChannelsForMember"] = (
    member,
  ) =>
    listChannelRowsForMember(member).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) =>
          listMemberRows(row.channelId).pipe(Effect.map((members) => ({ ...row, members }))),
        ),
      ),
      Effect.mapError(
        toPersistenceSqlError("ProjectionChannelRepository.listChannelsForMember:query"),
      ),
    );

  const listPosts: ProjectionChannelRepositoryShape["listPosts"] = (input) =>
    listPostRows({
      channelId: input.channelId,
      limit: input.limit,
      // The cursor is exclusive, so an absent one starts before every row.
      afterSequence: input.afterSequence ?? -1,
    }).pipe(Effect.mapError(toPersistenceSqlError("ProjectionChannelRepository.listPosts:query")));

  const listPostsBackward: ProjectionChannelRepositoryShape["listPostsBackward"] = (input) =>
    listPostRowsBackward({
      channelId: input.channelId,
      limit: input.limit,
      // Exclusive, so an absent cursor starts after every row. The sequence is
      // a safe integer by the time it reaches here; MAX_SAFE_INTEGER is the
      // only value that cannot be one.
      beforeSequence: input.beforeSequence ?? Number.MAX_SAFE_INTEGER,
    }).pipe(
      // ASCENDING on the way out. The query ordered by the newest end to pick
      // the window; the caller renders oldest-first.
      Effect.map((rows) => [...rows].reverse()),
      Effect.mapError(toPersistenceSqlError("ProjectionChannelRepository.listPostsBackward:query")),
    );

  return {
    upsertChannel,
    getChannelByName,
    getChannelById,
    replaceMembers,
    insertPost,
    getPost,
    getChannelWithActivityById,
    listChannelsForMember,
    listPosts,
    listPostsBackward,
  } satisfies ProjectionChannelRepositoryShape;
});

export const ProjectionChannelRepositoryLive = Layer.effect(
  ProjectionChannelRepository,
  makeProjectionChannelRepository,
);
