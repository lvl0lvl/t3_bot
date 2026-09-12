import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { ChannelId, ChannelMember, ChannelMemberHandle, IsoDateTime } from "@t3tools/contracts";

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
        ON CONFLICT (post_id) DO NOTHING
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

  const withMembers = (row: ProjectionChannelRow) =>
    listMemberRows(row.channelId).pipe(
      Effect.map((members) => ({ ...row, members: members as ReadonlyArray<ChannelMember> })),
    );

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

  const listPosts: ProjectionChannelRepositoryShape["listPosts"] = (input) =>
    listPostRows({
      channelId: input.channelId,
      limit: input.limit,
      // The cursor is exclusive, so an absent one starts before every row.
      afterSequence: input.afterSequence ?? -1,
    }).pipe(Effect.mapError(toPersistenceSqlError("ProjectionChannelRepository.listPosts:query")));

  return {
    upsertChannel,
    getChannelByName,
    getChannelById,
    replaceMembers,
    insertPost,
    getPost,
    listPosts,
  } satisfies ProjectionChannelRepositoryShape;
});

export const ProjectionChannelRepositoryLive = Layer.effect(
  ProjectionChannelRepository,
  makeProjectionChannelRepository,
);
