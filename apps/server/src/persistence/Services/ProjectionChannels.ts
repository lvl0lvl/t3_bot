/**
 * ProjectionChannelRepository - projection persistence for channels.
 *
 * The read side is shaped by `ChannelGatewayShape`, not by the entities: a
 * channel is fetched by NAME together with a membership test, a post by id
 * scoped to its channel, and posts page oldest-first from an opaque cursor.
 * Membership lives here rather than only in the in-memory read model because
 * the gateway answers without it.
 *
 * @module ProjectionChannelRepository
 */
import {
  ChannelId,
  ChannelMember,
  ChannelMemberHandle,
  ChannelPostId,
  IsoDateTime,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionChannel = Schema.Struct({
  channelId: ChannelId,
  name: Schema.String,
  members: Schema.Array(ChannelMember),
  archivedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectionChannel = typeof ProjectionChannel.Type;

/**
 * A channel plus the one thing a sidebar needs from its history.
 *
 * `latestPostAt` is the last POST's time, not the channel's `updatedAt`: a
 * membership edit is not activity, and a sidebar ordered by `updatedAt` reorders
 * itself when someone joins.
 */
export const ProjectionChannelWithActivity = Schema.Struct({
  channelId: ChannelId,
  name: Schema.String,
  members: Schema.Array(ChannelMember),
  archivedAt: Schema.NullOr(IsoDateTime),
  latestPostAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectionChannelWithActivity = typeof ProjectionChannelWithActivity.Type;

/**
 * Who is asking. The same two fields `ChannelMember` carries and the decider's
 * issuer uses, so this is not a new vocabulary.
 *
 * DERIVED FROM THE CALLER'S OWN CREDENTIAL, NEVER FROM A REQUEST FIELD. It is a
 * parameter where the caller's own thread used to be hardcoded, so "read as
 * someone else" is one argument away and there is no decider on the read side to
 * refuse it. Every caller owes a test that its ref comes from the credential and
 * not from the payload.
 */
export interface ChannelMemberRef {
  readonly memberKind: "thread" | "human";
  readonly memberId: string;
}

export const ProjectionChannelPost = Schema.Struct({
  postId: ChannelPostId,
  channelId: ChannelId,
  /** The event sequence. Orders a channel's posts and backs the cursor. */
  sequence: Schema.Number,
  authorHandle: ChannelMemberHandle,
  body: Schema.String,
  mentions: Schema.Array(ChannelMemberHandle),
  parentPostId: Schema.NullOr(ChannelPostId),
  createdAt: IsoDateTime,
});
export type ProjectionChannelPost = typeof ProjectionChannelPost.Type;

export interface ListChannelPostsInput {
  readonly channelId: ChannelId;
  /** A maximum, not an exact count. */
  readonly limit: number;
  /** Exclusive: rows strictly after this sequence. Omitted for the first page. */
  readonly afterSequence: number | undefined;
}

export interface ProjectionChannelRepositoryShape {
  readonly upsertChannel: (
    row: ProjectionChannel,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * The channel with this name, if any.
   *
   * Membership is NOT filtered here. The caller conflates "not a member" with
   * "no such channel" so an agent cannot probe for channels it is not in, and
   * that conflation belongs at the gateway where the caller's identity is
   * known — not in storage, where it would also hide the row from the
   * projector that has to update it.
   */
  readonly getChannelByName: (
    name: string,
  ) => Effect.Effect<Option.Option<ProjectionChannel>, ProjectionRepositoryError>;

  readonly getChannelById: (
    channelId: ChannelId,
  ) => Effect.Effect<Option.Option<ProjectionChannel>, ProjectionRepositoryError>;

  /** Replaces the channel's membership wholesale; the event carries the truth. */
  readonly replaceMembers: (input: {
    readonly channelId: ChannelId;
    readonly members: ReadonlyArray<ChannelMember>;
  }) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly insertPost: (
    row: ProjectionChannelPost,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /** One post, scoped to its channel so a foreign id reads as absent. */
  readonly getPost: (input: {
    readonly channelId: ChannelId;
    readonly postId: ChannelPostId;
  }) => Effect.Effect<Option.Option<ProjectionChannelPost>, ProjectionRepositoryError>;

  /**
   * Every channel this member belongs to, most recently active first.
   *
   * MEMBERSHIP IS THE FILTER, in the query rather than above it. A caller that
   * received every channel would know the names of channels it cannot read, and
   * "the caller does not show them" is a rule in a file that cannot enforce it.
   */
  readonly listChannelsForMember: (
    member: ChannelMemberRef,
  ) => Effect.Effect<ReadonlyArray<ProjectionChannelWithActivity>, ProjectionRepositoryError>;

  /** Oldest first, ascending by sequence. */
  readonly listPosts: (
    input: ListChannelPostsInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionChannelPost>, ProjectionRepositoryError>;
}

export class ProjectionChannelRepository extends Context.Service<
  ProjectionChannelRepository,
  ProjectionChannelRepositoryShape
>()("t3/persistence/Services/ProjectionChannels/ProjectionChannelRepository") {}
